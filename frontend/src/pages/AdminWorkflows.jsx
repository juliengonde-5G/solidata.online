import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Layout from '../components/Layout';
import { PageHeader, LoadingSpinner, ErrorState } from '../components';
import { Network, RotateCcw, Maximize2, X, ChevronRight, Info } from 'lucide-react';
import workflowsData from '../data/workflows.json';

const CYTO_CDN = 'https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js';

function loadCytoscape() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('SSR'));
    if (window.cytoscape) return resolve(window.cytoscape);
    const existing = document.querySelector(`script[data-cyto-loader="1"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.cytoscape));
      existing.addEventListener('error', () => reject(new Error('CDN load failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = CYTO_CDN;
    s.async = true;
    s.dataset.cytoLoader = '1';
    s.onload = () => resolve(window.cytoscape);
    s.onerror = () => reject(new Error('CDN load failed'));
    document.head.appendChild(s);
  });
}

// Couleurs par type de nœud (cohérent avec la palette SOLIDATA)
const NODE_COLORS = {
  container: '#2D8C4E',
  module: '#64748b',
  external: '#f97316',
  actor: '#0ea5e9',
};
const NODE_COLORS_DIM = {
  container: '#cbd5e1',
  module: '#e2e8f0',
  external: '#fde68a',
  actor: '#bae6fd',
};

// Couleurs par type d'arête
const EDGE_COLORS = {
  http: '#3b82f6',
  ws: '#a855f7',
  sql: '#b45309',
  cache: '#ef4444',
  job: '#ca8a04',
  ext: '#f97316',
  ui: '#10b981',
};

const EDGE_KIND_LABELS = {
  http: 'HTTP',
  ws: 'WebSocket',
  sql: 'SQL',
  cache: 'Cache Redis',
  job: 'Job async',
  ext: 'API externe',
  ui: 'Interaction UI',
};

function buildNodes(packages) {
  return packages.map((p) => ({
    data: {
      id: p.id,
      label: p.label,
      type: p.type,
      parent: p.parent || undefined,
      tech: p.tech || '',
      description: p.description || '',
      file: p.file || '',
    },
    classes: `type-${p.type}`,
    selectable: true,
    grabbable: true,
  }));
}

function buildFlowEdges(flow) {
  if (!flow) return [];
  return flow.steps.map((s, idx) => ({
    data: {
      id: `e-${flow.id}-${idx}`,
      source: s.from,
      target: s.to,
      label: `${idx + 1}`,
      stepIndex: idx,
      kind: s.kind,
      stepLabel: s.label,
    },
    classes: `flow-edge kind-${s.kind}`,
  }));
}

function cytoStyle() {
  return [
    {
      selector: 'node',
      style: {
        'background-color': (ele) => NODE_COLORS[ele.data('type')] || '#94a3b8',
        label: 'data(label)',
        color: '#ffffff',
        'font-size': 11,
        'font-weight': 600,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-outline-color': '#0f172a',
        'text-outline-width': 1,
        width: 'label',
        height: 32,
        padding: '10px',
        shape: 'round-rectangle',
        'transition-property': 'background-color, border-color, border-width, opacity',
        'transition-duration': '180ms',
      },
    },
    {
      selector: 'node:parent',
      style: {
        'background-opacity': 0.08,
        'background-color': (ele) => NODE_COLORS[ele.data('type')] || '#cbd5e1',
        'border-color': (ele) => NODE_COLORS[ele.data('type')] || '#94a3b8',
        'border-width': 2,
        'border-style': 'dashed',
        label: 'data(label)',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -6,
        color: (ele) => NODE_COLORS[ele.data('type')] || '#475569',
        'text-outline-width': 0,
        'font-size': 13,
        'font-weight': 700,
        padding: '20px',
        shape: 'round-rectangle',
      },
    },
    {
      selector: 'node.dimmed',
      style: { opacity: 0.18 },
    },
    {
      selector: 'node.active',
      style: {
        'border-color': '#facc15',
        'border-width': 3,
        'border-style': 'solid',
      },
    },
    {
      selector: 'node.hovered',
      style: {
        'border-color': '#fb923c',
        'border-width': 4,
        'border-style': 'solid',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'line-color': '#cbd5e1',
        'target-arrow-color': '#cbd5e1',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        opacity: 0.5,
        'transition-property': 'line-color, target-arrow-color, width, opacity',
        'transition-duration': '180ms',
      },
    },
    {
      selector: 'edge.flow-edge',
      style: {
        width: 3,
        'line-color': (ele) => EDGE_COLORS[ele.data('kind')] || '#475569',
        'target-arrow-color': (ele) => EDGE_COLORS[ele.data('kind')] || '#475569',
        label: 'data(label)',
        'font-size': 11,
        'font-weight': 700,
        color: '#0f172a',
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'text-background-shape': 'round-rectangle',
        'text-border-color': (ele) => EDGE_COLORS[ele.data('kind')] || '#475569',
        'text-border-width': 1,
        'text-border-opacity': 1,
        opacity: 1,
      },
    },
    {
      selector: 'edge.flow-edge.hovered',
      style: {
        width: 6,
        'line-color': '#fb923c',
        'target-arrow-color': '#fb923c',
        'z-index': 99,
      },
    },
  ];
}

function cytoLayout() {
  return {
    name: 'cose',
    animate: false,
    randomize: false,
    nodeRepulsion: 12000,
    idealEdgeLength: 120,
    edgeElasticity: 100,
    gravity: 0.6,
    numIter: 1200,
    nestingFactor: 1.4,
    padding: 24,
    nodeDimensionsIncludeLabels: true,
    fit: true,
  };
}

export default function AdminWorkflows() {
  const containerRef = useRef(null);
  const cyRef = useRef(null);

  const [cytoStatus, setCytoStatus] = useState('loading'); // loading | ready | error
  const [cytoError, setCytoError] = useState('');
  const [selectedFlowId, setSelectedFlowId] = useState(null);
  const [hoveredStep, setHoveredStep] = useState(null);
  const [hoverNode, setHoverNode] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);

  const { packages, flows, legend } = workflowsData;

  const flowsByDomain = useMemo(() => {
    const map = new Map();
    flows.forEach((f) => {
      const arr = map.get(f.domain) || [];
      arr.push(f);
      map.set(f.domain, arr);
    });
    return Array.from(map.entries());
  }, [flows]);

  const selectedFlow = useMemo(
    () => flows.find((f) => f.id === selectedFlowId) || null,
    [flows, selectedFlowId],
  );

  // Charge Cytoscape via CDN
  useEffect(() => {
    let cancelled = false;
    loadCytoscape()
      .then(() => {
        if (!cancelled) setCytoStatus('ready');
      })
      .catch((err) => {
        if (!cancelled) {
          setCytoError(err.message || 'CDN inaccessible');
          setCytoStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialise / reconstruit le graphe quand le flux change
  useEffect(() => {
    if (cytoStatus !== 'ready' || !containerRef.current || !window.cytoscape) return;

    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
    }

    const elements = [...buildNodes(packages), ...buildFlowEdges(selectedFlow)];

    const cy = window.cytoscape({
      container: containerRef.current,
      elements,
      style: cytoStyle(),
      layout: cytoLayout(),
      wheelSensitivity: 0.25,
      minZoom: 0.3,
      maxZoom: 2.5,
      boxSelectionEnabled: false,
    });

    cy.on('tap', 'node', (evt) => {
      setHoverNode(evt.target.data());
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) setHoverNode(null);
    });

    // Si un flux est actif, on dimme tout sauf les nœuds impliqués
    if (selectedFlow) {
      const involved = new Set();
      selectedFlow.steps.forEach((s) => {
        involved.add(s.from);
        involved.add(s.to);
      });
      // Ajoute les ancêtres compound (parents)
      involved.forEach((id) => {
        const n = cy.$(`#${id}`);
        n.ancestors().forEach((a) => involved.add(a.id()));
      });
      cy.nodes().forEach((n) => {
        if (!involved.has(n.id())) n.addClass('dimmed');
        else n.addClass('active');
      });
    }

    cyRef.current = cy;

    return () => {
      cy.destroy();
      if (cyRef.current === cy) cyRef.current = null;
    };
  }, [cytoStatus, selectedFlow, packages]);

  // Met en évidence l'étape survolée
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedFlow) return;
    cy.edges('.flow-edge').removeClass('hovered');
    cy.nodes().removeClass('hovered');
    if (hoveredStep === null || hoveredStep === undefined) return;
    const step = selectedFlow.steps[hoveredStep];
    if (!step) return;
    cy.$(`edge[stepIndex = ${hoveredStep}]`).addClass('hovered');
    cy.$(`#${step.from}`).addClass('hovered');
    cy.$(`#${step.to}`).addClass('hovered');
  }, [hoveredStep, selectedFlow]);

  const handleReset = useCallback(() => {
    setSelectedFlowId(null);
    setHoveredStep(null);
    setHoverNode(null);
  }, []);

  const handleFit = useCallback(() => {
    cyRef.current?.fit(undefined, 30);
  }, []);

  return (
    <Layout>
      <PageHeader
        title="Workflows applicatifs"
        subtitle={`${packages.length} composants · ${flows.length} flux documentés · piloté par frontend/src/data/workflows.json`}
        icon={Network}
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleFit}
              className="px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg hover:bg-gray-50 flex items-center gap-2"
              title="Recadrer"
            >
              <Maximize2 className="w-4 h-4" />
              Recadrer
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg hover:bg-gray-50 flex items-center gap-2"
              title="Réinitialiser la sélection"
            >
              <RotateCcw className="w-4 h-4" />
              Réinitialiser
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-12 gap-4 mt-4">
        {/* Colonne gauche : flux + légende */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Flux disponibles</h3>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {flowsByDomain.map(([domain, list]) => (
                <div key={domain}>
                  <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-1.5">
                    {domain}
                  </div>
                  <ul className="space-y-1">
                    {list.map((f) => {
                      const active = selectedFlowId === f.id;
                      return (
                        <li key={f.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedFlowId(f.id);
                              setHoveredStep(null);
                            }}
                            className={`w-full text-left px-2.5 py-2 rounded-lg text-sm flex items-center justify-between gap-2 transition ${
                              active
                                ? 'bg-primary text-white font-semibold shadow-sm'
                                : 'hover:bg-gray-100 text-gray-700'
                            }`}
                          >
                            <span className="truncate">{f.label}</span>
                            <ChevronRight
                              className={`w-4 h-4 flex-shrink-0 ${active ? 'text-white' : 'text-gray-400'}`}
                            />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Légende */}
          <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-1.5">
              <Info className="w-4 h-4" /> Légende
            </h3>
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-1.5">
                Composants
              </div>
              <ul className="space-y-1 text-xs">
                {Object.entries(legend.node_types).map(([k, v]) => (
                  <li key={k} className="flex items-start gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full flex-shrink-0 mt-0.5"
                      style={{ background: NODE_COLORS[k] }}
                    />
                    <span>
                      <span className="font-semibold capitalize">{k}</span> — <span className="text-gray-600">{v}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-1.5">
                Liens (couleur d'arête)
              </div>
              <ul className="space-y-1 text-xs">
                {Object.entries(legend.edge_kinds).map(([k, v]) => (
                  <li key={k} className="flex items-start gap-2">
                    <span
                      className="inline-block w-4 h-1 flex-shrink-0 mt-2 rounded"
                      style={{ background: EDGE_COLORS[k] }}
                    />
                    <span>
                      <span className="font-semibold">{EDGE_KIND_LABELS[k]}</span> — <span className="text-gray-600">{v}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        {/* Colonne droite : graphe + étapes */}
        <main className="col-span-12 lg:col-span-9 space-y-4">
          <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden">
            {/* Bandeau d'info du flux sélectionné */}
            {selectedFlow ? (
              <div className="px-4 py-3 border-b border-[var(--color-border)] bg-gradient-to-r from-emerald-50 to-transparent">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
                      {selectedFlow.domain}
                    </div>
                    <h2 className="text-base font-bold text-gray-900">{selectedFlow.label}</h2>
                    <p className="text-sm text-gray-700 mt-1">{selectedFlow.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-gray-400 hover:text-gray-700 p-1"
                    aria-label="Fermer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 border-b border-[var(--color-border)] bg-gray-50">
                <p className="text-sm text-gray-600">
                  Sélectionne un flux à gauche pour mettre en évidence le parcours entre composants. Le graphe est draggable et zoomable.
                </p>
              </div>
            )}

            {/* Conteneur Cytoscape */}
            <div className="relative" style={{ height: fullscreen ? 'calc(100vh - 240px)' : 540 }}>
              {cytoStatus === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                  <LoadingSpinner />
                  <span className="ml-3 text-sm text-gray-500">Chargement de Cytoscape (CDN)…</span>
                </div>
              )}
              {cytoStatus === 'error' && (
                <div className="p-6">
                  <ErrorState
                    title="Impossible de charger Cytoscape"
                    message={`${cytoError} — vérifie la connexion au CDN unpkg.com.`}
                  />
                </div>
              )}
              <div
                ref={containerRef}
                className="w-full h-full"
                style={{ background: '#f8fafc' }}
              />
              {/* Tooltip nœud */}
              {hoverNode && (
                <div className="absolute top-3 left-3 max-w-md bg-white border border-[var(--color-border)] rounded-lg shadow-lg p-3 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ background: NODE_COLORS[hoverNode.type] }}
                    />
                    <span className="font-bold text-gray-900">{hoverNode.label}</span>
                    <span className="text-gray-400">· {hoverNode.type}</span>
                  </div>
                  {hoverNode.tech && (
                    <div className="text-gray-600 italic mb-1">{hoverNode.tech}</div>
                  )}
                  {hoverNode.description && (
                    <div className="text-gray-700">{hoverNode.description}</div>
                  )}
                  {hoverNode.file && (
                    <div className="mt-1 font-mono text-[10px] text-gray-500">{hoverNode.file}</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Panneau des étapes */}
          {selectedFlow && (
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
              <h3 className="text-sm font-bold text-gray-900 mb-3">
                Étapes du flux ({selectedFlow.steps.length})
                <span className="text-xs font-normal text-gray-500 ml-2">
                  Survole une étape pour la mettre en évidence sur le graphe.
                </span>
              </h3>
              <ol className="space-y-2">
                {selectedFlow.steps.map((step, idx) => {
                  const fromPkg = packages.find((p) => p.id === step.from);
                  const toPkg = packages.find((p) => p.id === step.to);
                  return (
                    <li
                      key={idx}
                      onMouseEnter={() => setHoveredStep(idx)}
                      onMouseLeave={() => setHoveredStep(null)}
                      className={`border rounded-lg p-3 transition cursor-default ${
                        hoveredStep === idx
                          ? 'border-orange-400 bg-orange-50 shadow-sm'
                          : 'border-[var(--color-border)] hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ background: EDGE_COLORS[step.kind] || '#475569' }}
                        >
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 mb-0.5">
                            <span className="font-semibold text-gray-700">
                              {fromPkg?.label || step.from}
                            </span>
                            <span>→</span>
                            <span className="font-semibold text-gray-700">
                              {toPkg?.label || step.to}
                            </span>
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                              style={{ background: EDGE_COLORS[step.kind] || '#475569' }}
                            >
                              {EDGE_KIND_LABELS[step.kind] || step.kind}
                            </span>
                          </div>
                          <div className="text-sm font-medium text-gray-900">{step.label}</div>
                          {step.details && (
                            <div className="text-xs text-gray-600 mt-1">{step.details}</div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </main>
      </div>
    </Layout>
  );
}
