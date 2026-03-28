"""
SolidataBot — Agent conversationnel IA pour Solidata ERP
Flask backend avec intégration Claude API (tool use)
"""

import os
import json
import logging
import time
import uuid
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, jsonify, render_template, g
from sqlalchemy import create_engine, text
from sqlalchemy.pool import QueuePool
import redis
import anthropic
import bleach
import jwt as pyjwt

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", "solidata-agent-dev-key"),
    DB_URL=os.environ.get(
        "DATABASE_URL",
        "postgresql://{user}:{pw}@{host}:{port}/{db}".format(
            user=os.environ.get("DB_USER", "solidata_user"),
            pw=os.environ.get("DB_PASSWORD", "solidata_pass"),
            host=os.environ.get("DB_HOST", "solidata-db"),
            port=os.environ.get("DB_PORT", "5432"),
            db=os.environ.get("DB_NAME", "solidata"),
        ),
    ),
    REDIS_URL=os.environ.get("REDIS_URL", "redis://solidata-redis:6379/1"),
    ANTHROPIC_API_KEY=os.environ.get("ANTHROPIC_API_KEY", ""),
    CLAUDE_MODEL=os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
    JWT_SECRET=os.environ.get("JWT_SECRET", "solidata-jwt-secret"),
    RATE_LIMIT_PER_MIN=int(os.environ.get("RATE_LIMIT_PER_MIN", "20")),
    MAX_HISTORY=10,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("solidatabot")

# ---------------------------------------------------------------------------
# Database (read-only connection)
# ---------------------------------------------------------------------------

engine = create_engine(
    app.config["DB_URL"],
    poolclass=QueuePool,
    pool_size=5,
    max_overflow=2,
    pool_pre_ping=True,
    execution_options={"postgresql_readonly": True},
)

# ---------------------------------------------------------------------------
# Redis (session / historique / rate limit)
# ---------------------------------------------------------------------------

redis_client = redis.from_url(app.config["REDIS_URL"], decode_responses=True)

# ---------------------------------------------------------------------------
# Anthropic client
# ---------------------------------------------------------------------------

claude = anthropic.Anthropic(api_key=app.config["ANTHROPIC_API_KEY"])

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """Tu es SolidataBot, l'assistant amical de Solidarité Textiles à Rouen.

REGLES :
- Réponds TOUJOURS en français, de manière simple et courte (max 100 mots).
- Utilise des emojis pour rendre tes réponses visuelles : 📦 stock, 🚛 collecte, 📅 planning, 👋 salut, ✅ ok, ❌ erreur.
- Pour les utilisateurs en insertion (profil PCM, faible lecture) : utilise un langage très simple, des phrases courtes, des icônes.
- Tu as accès à la base de données via des outils (tools). N'invente JAMAIS de données.
- Si tu ne sais pas ou si la question sort du périmètre : "Désolé, je ne peux pas répondre à ça. Demande à un admin ! 🙋"
- Ne modifie JAMAIS la base de données. Lecture seule.
- Ne révèle jamais d'informations personnelles d'autres utilisateurs.
- Exemples de réponses :
  * "Stock jeans Rouen : 150 kg 📦"
  * "Ta prochaine mission : collecte mardi 9h 🚛"
  * "Collecte du 25/03 : 2 340 kg récoltés ✅"

CONTEXTE METIER :
- Solidarité Textiles est une SIAE de collecte, tri et valorisation de textiles usagés.
- CAV = Conteneur d'Apport Volontaire (point de collecte dans la rue).
- Filières : tri, collecte, logistique, boutique Frip & Co.
- Types textiles : crème (réemploi), catégorie 2 (recyclage), CSR, effilochage, VAK (export).
"""

# ---------------------------------------------------------------------------
# Claude tools definitions
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "name": "query_stock",
        "description": (
            "Interroge le stock de matières textiles. "
            "Retourne le poids total en kg par catégorie de matière. "
            "Peut filtrer par catégorie de matière (ex: 'crème', 'CSR', 'effilochage')."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "categorie": {
                    "type": "string",
                    "description": "Catégorie de matière à filtrer (ex: 'crème', 'CSR', 'effilochage'). Vide = toutes.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "query_planning",
        "description": (
            "Consulte le planning d'un employé pour la semaine en cours. "
            "Retourne les missions, postes et statuts jour par jour."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "employee_id": {
                    "type": "integer",
                    "description": "ID de l'employé. Si absent, utilise l'ID de l'utilisateur connecté.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "query_collecte",
        "description": (
            "Consulte les statistiques de collecte pour une date donnée ou la semaine en cours. "
            "Retourne le nombre de tournées, le poids total collecté, le nombre de CAV visités."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {
                    "type": "string",
                    "description": "Date au format YYYY-MM-DD. Si absent, utilise aujourd'hui.",
                },
                "periode": {
                    "type": "string",
                    "enum": ["jour", "semaine", "mois"],
                    "description": "Période de statistiques. Défaut: jour.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "query_heures",
        "description": (
            "Consulte les heures travaillées d'un employé sur une période. "
            "Retourne le total d'heures et le détail par jour."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "employee_id": {
                    "type": "integer",
                    "description": "ID de l'employé. Si absent, utilise l'ID de l'utilisateur connecté.",
                },
                "periode": {
                    "type": "string",
                    "enum": ["semaine", "mois"],
                    "description": "Période. Défaut: semaine.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "query_cav",
        "description": (
            "Recherche des informations sur les Conteneurs d'Apport Volontaire (CAV/PAV). "
            "Peut filtrer par commune ou statut."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "commune": {
                    "type": "string",
                    "description": "Nom de la commune pour filtrer les CAV.",
                },
                "statut": {
                    "type": "string",
                    "enum": ["active", "unavailable"],
                    "description": "Statut du CAV.",
                },
            },
            "required": [],
        },
    },
]

# ---------------------------------------------------------------------------
# Tool execution (read-only DB queries)
# ---------------------------------------------------------------------------


def execute_tool(tool_name: str, tool_input: dict, user_context: dict) -> str:
    """Execute a tool call and return the result as a string."""
    try:
        with engine.connect() as conn:
            if tool_name == "query_stock":
                return _query_stock(conn, tool_input)
            elif tool_name == "query_planning":
                return _query_planning(conn, tool_input, user_context)
            elif tool_name == "query_collecte":
                return _query_collecte(conn, tool_input)
            elif tool_name == "query_heures":
                return _query_heures(conn, tool_input, user_context)
            elif tool_name == "query_cav":
                return _query_cav(conn, tool_input)
            else:
                return json.dumps({"error": f"Outil inconnu : {tool_name}"})
    except Exception as e:
        logger.error(f"Tool execution error ({tool_name}): {e}")
        return json.dumps({"error": "Erreur lors de la requête en base de données."})


def _query_stock(conn, params):
    categorie = params.get("categorie", "").strip()
    if categorie:
        result = conn.execute(
            text("""
                SELECT m.categorie, m.sous_categorie,
                       COALESCE(SUM(CASE WHEN sm.type='entree' THEN sm.poids_kg ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN sm.type='sortie' THEN sm.poids_kg ELSE 0 END), 0) AS stock_kg
                FROM matieres m
                LEFT JOIN stock_movements sm ON sm.matiere_id = m.id
                WHERE LOWER(m.categorie) LIKE :cat
                GROUP BY m.categorie, m.sous_categorie
                ORDER BY stock_kg DESC
            """),
            {"cat": f"%{categorie.lower()}%"},
        )
    else:
        result = conn.execute(
            text("""
                SELECT m.categorie,
                       COALESCE(SUM(CASE WHEN sm.type='entree' THEN sm.poids_kg ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN sm.type='sortie' THEN sm.poids_kg ELSE 0 END), 0) AS stock_kg
                FROM matieres m
                LEFT JOIN stock_movements sm ON sm.matiere_id = m.id
                GROUP BY m.categorie
                HAVING COALESCE(SUM(CASE WHEN sm.type='entree' THEN sm.poids_kg ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN sm.type='sortie' THEN sm.poids_kg ELSE 0 END), 0) > 0
                ORDER BY stock_kg DESC
            """)
        )
    rows = [dict(r._mapping) for r in result]
    if not rows:
        return json.dumps({"message": "Aucun stock trouvé.", "data": []})
    return json.dumps({"data": rows}, default=str)


def _query_planning(conn, params, user_ctx):
    emp_id = params.get("employee_id")
    # Si pas d'ID fourni, chercher l'employé lié à l'utilisateur connecté
    if not emp_id and user_ctx.get("user_id"):
        row = conn.execute(
            text("SELECT id FROM employees WHERE user_id = :uid AND is_active = true"),
            {"uid": user_ctx["user_id"]},
        ).fetchone()
        if row:
            emp_id = row[0]
    if not emp_id:
        return json.dumps({"error": "Impossible de déterminer l'employé. Précise un ID."})

    # Vérification RGPD : un COLLABORATEUR ne peut voir que son propre planning
    if user_ctx.get("role") == "COLLABORATEUR":
        own = conn.execute(
            text("SELECT id FROM employees WHERE user_id = :uid"),
            {"uid": user_ctx["user_id"]},
        ).fetchone()
        if not own or own[0] != emp_id:
            return json.dumps({"error": "Tu ne peux consulter que ton propre planning."})

    today = datetime.now().date()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)

    result = conn.execute(
        text("""
            SELECT s.date, s.status, s.poste_code, s.is_provisional,
                   p.name AS poste_name
            FROM schedule s
            LEFT JOIN positions p ON p.id = s.position_id
            WHERE s.employee_id = :eid AND s.date BETWEEN :start AND :end
            ORDER BY s.date
        """),
        {"eid": emp_id, "start": monday, "end": sunday},
    )
    rows = [dict(r._mapping) for r in result]
    return json.dumps({
        "employee_id": emp_id,
        "semaine": f"{monday} → {sunday}",
        "planning": rows,
    }, default=str)


def _query_collecte(conn, params):
    date_str = params.get("date", datetime.now().strftime("%Y-%m-%d"))
    periode = params.get("periode", "jour")

    try:
        ref_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return json.dumps({"error": "Format de date invalide. Utilise YYYY-MM-DD."})

    if periode == "semaine":
        start = ref_date - timedelta(days=ref_date.weekday())
        end = start + timedelta(days=6)
    elif periode == "mois":
        start = ref_date.replace(day=1)
        next_month = start.replace(day=28) + timedelta(days=4)
        end = next_month - timedelta(days=next_month.day)
    else:
        start = end = ref_date

    result = conn.execute(
        text("""
            SELECT COUNT(*) AS nb_tournees,
                   COALESCE(SUM(total_weight_kg), 0) AS poids_total_kg,
                   COALESCE(SUM(nb_cav), 0) AS cav_visites,
                   COUNT(CASE WHEN status = 'completed' THEN 1 END) AS terminees
            FROM tours
            WHERE date BETWEEN :start AND :end
        """),
        {"start": start, "end": end},
    )
    row = dict(result.fetchone()._mapping)
    row["periode"] = periode
    row["du"] = str(start)
    row["au"] = str(end)
    return json.dumps(row, default=str)


def _query_heures(conn, params, user_ctx):
    emp_id = params.get("employee_id")
    if not emp_id and user_ctx.get("user_id"):
        row = conn.execute(
            text("SELECT id FROM employees WHERE user_id = :uid AND is_active = true"),
            {"uid": user_ctx["user_id"]},
        ).fetchone()
        if row:
            emp_id = row[0]
    if not emp_id:
        return json.dumps({"error": "Impossible de déterminer l'employé."})

    # RGPD
    if user_ctx.get("role") == "COLLABORATEUR":
        own = conn.execute(
            text("SELECT id FROM employees WHERE user_id = :uid"),
            {"uid": user_ctx["user_id"]},
        ).fetchone()
        if not own or own[0] != emp_id:
            return json.dumps({"error": "Tu ne peux consulter que tes propres heures."})

    periode = params.get("periode", "semaine")
    today = datetime.now().date()
    if periode == "mois":
        start = today.replace(day=1)
        next_month = start.replace(day=28) + timedelta(days=4)
        end = next_month - timedelta(days=next_month.day)
    else:
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)

    result = conn.execute(
        text("""
            SELECT date, hours_worked, overtime_hours, type
            FROM work_hours
            WHERE employee_id = :eid AND date BETWEEN :start AND :end
            ORDER BY date
        """),
        {"eid": emp_id, "start": start, "end": end},
    )
    rows = [dict(r._mapping) for r in result]
    total = sum(r.get("hours_worked", 0) or 0 for r in rows)
    return json.dumps({
        "employee_id": emp_id,
        "periode": f"{start} → {end}",
        "total_heures": round(total, 1),
        "detail": rows,
    }, default=str)


def _query_cav(conn, params):
    commune = params.get("commune", "").strip()
    statut = params.get("statut", "").strip()

    conditions = []
    bind = {}
    if commune:
        conditions.append("LOWER(commune) LIKE :commune")
        bind["commune"] = f"%{commune.lower()}%"
    if statut:
        conditions.append("status = :statut")
        bind["statut"] = statut

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    result = conn.execute(
        text(f"""
            SELECT name, address, commune, status, nb_containers,
                   ROUND(avg_fill_rate::numeric, 1) AS taux_remplissage
            FROM cav
            {where}
            ORDER BY commune, name
            LIMIT 20
        """),
        bind,
    )
    rows = [dict(r._mapping) for r in result]
    total = conn.execute(
        text(f"SELECT COUNT(*) FROM cav {where}"), bind
    ).scalar()
    return json.dumps({"total": total, "affichage": len(rows), "cav": rows}, default=str)


# ---------------------------------------------------------------------------
# RGPD Audit logging
# ---------------------------------------------------------------------------


def log_audit(user_id, action, details=""):
    """Log an action for RGPD compliance."""
    try:
        redis_client.lpush(
            "solidatabot:audit",
            json.dumps({
                "timestamp": datetime.now().isoformat(),
                "user_id": user_id,
                "action": action,
                "details": details[:500],
            }),
        )
        redis_client.ltrim("solidatabot:audit", 0, 9999)
    except Exception as e:
        logger.warning(f"Audit log failed: {e}")


# ---------------------------------------------------------------------------
# Auth middleware (JWT)
# ---------------------------------------------------------------------------


def require_auth(f):
    """Verify JWT token from Authorization header or query param."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
        if not token:
            token = request.args.get("token")

        if not token:
            return jsonify({"error": "Token manquant"}), 401

        try:
            payload = pyjwt.decode(
                token, app.config["JWT_SECRET"], algorithms=["HS256"]
            )
            g.user = {
                "user_id": payload.get("userId") or payload.get("user_id"),
                "role": payload.get("role", "COLLABORATEUR"),
                "username": payload.get("username", ""),
            }
        except pyjwt.ExpiredSignatureError:
            return jsonify({"error": "Token expiré"}), 401
        except pyjwt.InvalidTokenError:
            return jsonify({"error": "Token invalide"}), 401

        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


def check_rate_limit(user_id):
    key = f"solidatabot:rate:{user_id}"
    count = redis_client.incr(key)
    if count == 1:
        redis_client.expire(key, 60)
    return count <= app.config["RATE_LIMIT_PER_MIN"]


# ---------------------------------------------------------------------------
# Chat session management (Redis)
# ---------------------------------------------------------------------------


def get_history(session_id: str) -> list:
    raw = redis_client.get(f"solidatabot:hist:{session_id}")
    if raw:
        return json.loads(raw)
    return []


def save_history(session_id: str, history: list):
    # Keep only last MAX_HISTORY messages
    trimmed = history[-(app.config["MAX_HISTORY"] * 2):]
    redis_client.setex(
        f"solidatabot:hist:{session_id}",
        3600,  # 1h TTL
        json.dumps(trimmed),
    )


# ---------------------------------------------------------------------------
# Core chat logic
# ---------------------------------------------------------------------------


def chat_with_claude(user_message: str, session_id: str, user_context: dict) -> str:
    """Send message to Claude with tools, handle tool calls, return final text."""
    history = get_history(session_id)
    history.append({"role": "user", "content": user_message})

    messages = history.copy()
    max_iterations = 5  # prevent infinite tool loops

    for _ in range(max_iterations):
        response = claude.messages.create(
            model=app.config["CLAUDE_MODEL"],
            max_tokens=512,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # Collect all content blocks
        assistant_content = response.content
        messages.append({"role": "assistant", "content": assistant_content})

        # Check if there are tool calls
        tool_uses = [b for b in assistant_content if b.type == "tool_use"]
        if not tool_uses:
            # No tool calls — extract text
            text_parts = [b.text for b in assistant_content if b.type == "text"]
            final_text = "\n".join(text_parts) if text_parts else "🤔"
            break
        else:
            # Execute each tool and send results back
            tool_results = []
            for tu in tool_uses:
                log_audit(
                    user_context.get("user_id"),
                    f"tool:{tu.name}",
                    json.dumps(tu.input),
                )
                result = execute_tool(tu.name, tu.input, user_context)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": result,
                })
            messages.append({"role": "user", "content": tool_results})
    else:
        final_text = "Désolé, je n'ai pas pu traiter ta demande. Réessaie ! 🔄"

    # Save history (simplified — only user/assistant text)
    history.append({"role": "assistant", "content": final_text})
    save_history(session_id, history)

    return final_text


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.route("/")
def index():
    """Serve the chat interface."""
    return render_template("chat.html")


@app.route("/health")
def health():
    """Health check endpoint."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        redis_client.ping()
        return jsonify({"status": "ok", "timestamp": datetime.now().isoformat()})
    except Exception as e:
        return jsonify({"status": "error", "detail": str(e)}), 500


@app.route("/chat", methods=["POST"])
@require_auth
def chat():
    """Main chat endpoint."""
    data = request.get_json(silent=True)
    if not data or not data.get("message"):
        return jsonify({"error": "Message requis"}), 400

    user_message = bleach.clean(data["message"].strip())[:500]
    if not user_message:
        return jsonify({"error": "Message vide"}), 400

    user_id = g.user.get("user_id", 0)
    if not check_rate_limit(user_id):
        return jsonify({"error": "Trop de messages. Attends un peu ! ⏳"}), 429

    session_id = data.get("session_id") or f"u{user_id}_{uuid.uuid4().hex[:8]}"

    log_audit(user_id, "chat_message", user_message[:200])

    try:
        reply = chat_with_claude(user_message, session_id, g.user)
    except anthropic.APIError as e:
        logger.error(f"Claude API error: {e}")
        return jsonify({"error": "Service IA temporairement indisponible. 🔧"}), 503
    except Exception as e:
        logger.error(f"Chat error: {e}")
        return jsonify({"error": "Une erreur est survenue. Réessaie ! 🔄"}), 500

    return jsonify({
        "reply": reply,
        "session_id": session_id,
        "timestamp": datetime.now().isoformat(),
    })


# Dev-only: token generation for testing (disabled in production)
@app.route("/dev/token", methods=["POST"])
def dev_token():
    """Generate a test JWT token (dev only)."""
    if os.environ.get("FLASK_ENV") == "production":
        return jsonify({"error": "Non disponible en production"}), 403
    data = request.get_json(silent=True) or {}
    payload = {
        "userId": data.get("user_id", 1),
        "role": data.get("role", "ADMIN"),
        "username": data.get("username", "dev"),
        "exp": datetime.utcnow() + timedelta(hours=8),
    }
    token = pyjwt.encode(payload, app.config["JWT_SECRET"], algorithm="HS256")
    return jsonify({"token": token})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    debug = os.environ.get("FLASK_ENV") != "production"
    app.run(host="0.0.0.0", port=port, debug=debug)
