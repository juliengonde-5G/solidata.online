import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal, PageHeader } from '../components';
import { Newspaper } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const CATEGORIES = [
  { id: 'all', label: 'Tout', color: 'bg-gray-100 text-gray-700' },
  { id: 'metier', label: 'Filiere & Reglementation', color: 'bg-blue-100 text-blue-700' },
  { id: 'local', label: 'Actualite locale', color: 'bg-green-100 text-green-700' },
];

const TAG_SUGGESTIONS = [
  'reglementation', 'collecte', 'tri', 'recyclage', 'revalorisation',
  'textile', 'juridique', 'fiscal', 'REP', 'eco-organisme',
  'formation', 'insertion', 'emploi', 'evenement', 'partenaire',
];

export default function NewsFeed() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [expandedArticle, setExpandedArticle] = useState(null);
  const [form, setForm] = useState({ category: 'metier', title: '', summary: '', content: '', source_url: '', source_name: '', tags: [], is_pinned: false });
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'RH';

  useEffect(() => { loadArticles(); }, [filter]);

  const loadArticles = async () => {
    try {
      const params = filter !== 'all' ? `?category=${filter}` : '';
      const res = await api.get(`/news${params}`);
      setArticles(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const createArticle = async (e) => {
    e.preventDefault();
    try {
      await api.post('/news', form);
      setShowForm(false);
      setForm({ category: 'metier', title: '', summary: '', content: '', source_url: '', source_name: '', tags: [], is_pinned: false });
      loadArticles();
    } catch (err) { console.error(err); alert('Erreur lors de la creation'); }
  };

  const deleteArticle = async (id) => {
    if (!confirm('Supprimer cet article ?')) return;
    try {
      await api.delete(`/news/${id}`);
      loadArticles();
    } catch (err) { console.error(err); }
  };

  const togglePin = async (article) => {
    try {
      await api.put(`/news/${article.id}`, { is_pinned: !article.is_pinned });
      loadArticles();
    } catch (err) { console.error(err); }
  };

  const toggleTag = (tag) => {
    setForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag],
    }));
  };

  const formatDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des actualités..." /></Layout>;

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        <PageHeader
          title="Fil d'actualite"
          subtitle="Veille reglementaire, actualite filiere textile et nouvelles locales"
          icon={Newspaper}
          actions={
            isAdmin && (
              <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
                + Publier
              </button>
            )
          }
        />

        {/* Filtres */}
        <div className="flex gap-2 mb-6">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setFilter(cat.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                filter === cat.id ? `${cat.color} shadow-sm` : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Articles */}
        <div className="space-y-4">
          {articles.length === 0 ? (
            <div className="card-modern p-12 text-center">
              <p className="text-gray-400">Aucun article pour le moment</p>
              {isAdmin && <p className="text-sm text-gray-300 mt-1">Cliquez sur "Publier" pour ajouter du contenu</p>}
            </div>
          ) : articles.map(article => {
            const isExpanded = expandedArticle === article.id;
            const hasFullContent = article.content && article.content.length > 0;
            const hasMore = hasFullContent || article.source_url;
            return (
            <div key={article.id} className={`card-modern p-5 transition-all ${article.is_pinned ? 'border-l-4 border-l-amber-400' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    {article.is_pinned && <span className="text-amber-500 text-xs font-bold">EPINGLE</span>}
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      article.category === 'metier' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {article.category === 'metier' ? 'FILIERE' : 'LOCAL'}
                    </span>
                    <span className="text-xs text-gray-400">{formatDate(article.created_at)}</span>
                    {article.author_name && <span className="text-xs text-gray-400">• {article.author_name}</span>}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">{article.title}</h3>
                  {article.summary && <p className="text-sm text-gray-600 mb-2 leading-relaxed">{article.summary}</p>}

                  {/* Contenu complet : affiché si article expandé */}
                  {isExpanded && (
                    <div className="mt-3 p-4 bg-gray-50 rounded-lg border">
                      {hasFullContent && (
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{article.content}</p>
                      )}
                      {article.source_url && (
                        <div className={`${hasFullContent ? 'mt-4 pt-3 border-t border-gray-200' : ''}`}>
                          <a href={article.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 transition">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            Lire sur {article.source_name || 'la source'}
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Bouton Lire l'article complet / Réduire */}
                  <div className="flex items-center gap-3 mt-3">
                    {hasMore && (
                      <button
                        onClick={() => setExpandedArticle(isExpanded ? null : article.id)}
                        className="text-sm text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition"
                      >
                        {isExpanded ? (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                            Reduire
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            {hasFullContent ? 'Lire l\'article complet' : 'Voir la source'}
                          </>
                        )}
                      </button>
                    )}
                    {!isExpanded && article.source_url && (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                        {article.source_name || 'Source externe'}
                      </span>
                    )}
                  </div>

                  {article.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {article.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">#{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button onClick={() => togglePin(article)} className="text-xs text-amber-500 hover:text-amber-700" title="Epingler">
                      {article.is_pinned ? 'Desepingler' : 'Epingler'}
                    </button>
                    <button onClick={() => deleteArticle(article.id)} className="text-xs text-red-400 hover:text-red-600">
                      Supprimer
                    </button>
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Creation form modal */}
      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Publier un article" size="md"
        footer={<>
          <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-gray-500 text-sm">Annuler</button>
          <button type="submit" form="newsfeed-form" className="btn-primary text-sm">Publier</button>
        </>}
      >
        <form id="newsfeed-form" onSubmit={createArticle} className="space-y-3">
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="select-modern">
            <option value="metier">Filiere & Reglementation</option>
            <option value="local">Actualite locale</option>
          </select>
          <input placeholder="Titre *" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="input-modern" required />
          <textarea placeholder="Resume (2-3 lignes)" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} className="textarea-modern" rows={2} />
          <textarea placeholder="Contenu detaille (optionnel)" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} className="textarea-modern" rows={5} />
          <input placeholder="URL source (optionnel)" value={form.source_url} onChange={e => setForm({ ...form, source_url: e.target.value })} className="input-modern" />
          <input placeholder="Nom de la source (optionnel)" value={form.source_name} onChange={e => setForm({ ...form, source_name: e.target.value })} className="input-modern" />

          <div>
            <p className="text-xs text-gray-500 mb-2">Tags :</p>
            <div className="flex flex-wrap gap-1">
              {TAG_SUGGESTIONS.map(tag => (
                <button key={tag} type="button" onClick={() => toggleTag(tag)}
                  className={`px-2 py-1 rounded text-xs transition ${form.tags.includes(tag) ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  #{tag}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_pinned} onChange={e => setForm({ ...form, is_pinned: e.target.checked })} className="rounded" />
            Epingler en haut du fil
          </label>
        </form>
      </Modal>
    </Layout>
  );
}
