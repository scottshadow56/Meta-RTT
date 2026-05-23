import React, { useState, useEffect, useMemo } from 'react';
import { DimensionCount, Premise, TrainingStats, SolverResult, Vector } from './types';
import { solveRelations, getBasisRelations } from './utils/engine';
import Visualizer from './components/Visualizer';
import TrainingWorkspace from './components/TrainingWorkspace';
import SandboxWorkspace from './components/SandboxWorkspace';
import AnalyticsPanel from './components/AnalyticsPanel';
import ContextProjector from './components/ContextProjector';
import { Brain, Compass, Layers, Activity, FileText, Zap, Sparkles, Trophy, Network } from 'lucide-react';

const LOCAL_STORAGE_KEY = 'rrt_neural_stats_v1';

const defaultStats: TrainingStats = {
  score: 0,
  streak: 0,
  accuracy: 0,
  totalAnswered: 0,
  totalCorrect: 0,
  averageTimeMs: 0,
  history: []
};

export default function App() {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'training' | 'sandbox' | 'analytics' | 'manual'>('training');

  // Workout mode selection inside Training tab
  const [workoutMode, setWorkoutMode] = useState<'classic' | 'context'>('classic');
  const [contextBaseVector, setContextBaseVector] = useState<number[]>([1,0,0,0]);
  const [contextProjectedVector, setContextProjectedVector] = useState<number[]>([1,0,0,0]);
  const [contextBaseRelationName, setContextBaseRelationName] = useState<string>('NORTHEAST');
  const [contextProjectedRelationName, setContextProjectedRelationName] = useState<string>('NORTHEAST');
  const [contextActiveModifiers, setContextActiveModifiers] = useState<number[]>([1,1,1,1]);
  const [contextDimension, setContextDimension] = useState<DimensionCount>(2);
  const [contextNodeDefinitions, setContextNodeDefinitions] = useState<any[]>([]);
  const [contextVehicles, setContextVehicles] = useState<any[]>([]);

  // Dimensional Space setting
  const [dimension, setDimension] = useState<DimensionCount>(2);

  // Constraints/Premises list
  const [premises, setPremises] = useState<Premise[]>([]);

  // Basis relations of the currently selected dimension
  const [basisRelations, setBasisRelations] = useState<Record<string, Vector>>({});

  // Active hover highlighting of constraint vectors inside visualizer
  const [highlightedPremiseId, setHighlightedPremiseId] = useState<string | null>(null);

  // UI state for statistics loaded from localStorage
  const [stats, setStats] = useState<TrainingStats>(defaultStats);

  // Initialize statistics from localStorage
  useEffect(() => {
    try {
      const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (cached) {
        setStats(JSON.parse(cached));
      }
    } catch (err) {
      console.warn("Could not load analytics cache", err);
    }
  }, []);

  // Sync stats updates
  const handleUpdateStats = (newStats: TrainingStats) => {
    setStats(newStats);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newStats));
    } catch (err) {
      console.warn("Could not write analytics cache", err);
    }
  };

  const handleResetStats = () => {
    if (window.confirm("Are you sure you want to flush all neural logs and reset your fluid IQ metrics? This cannot be undone.")) {
      handleUpdateStats(defaultStats);
    }
  };

  // Keep basis relations mapping synchronized when the dimension counts change
  useEffect(() => {
    const defaults = getBasisRelations(dimension);
    setBasisRelations(defaults);
    
    // Clear out of bounds premises when dimension is downscaled
    setPremises(prev => prev.filter(p => {
      const vec = defaults[p.relation];
      return vec && vec.length === dimension;
    }));
  }, [dimension]);

  const handleUpdateContextDetails = (details: {
    dimension: DimensionCount;
    baseVector: number[];
    projectedVector: number[];
    baseRelationName: string;
    projectedRelationName: string;
    activeModifiers: number[];
    nodeDefinitions: any[];
    contextVehicles: any[];
  }) => {
    setContextDimension(details.dimension);
    setContextBaseVector(details.baseVector);
    setContextProjectedVector(details.projectedVector);
    setContextBaseRelationName(details.baseRelationName);
    setContextProjectedRelationName(details.projectedRelationName);
    setContextActiveModifiers(details.activeModifiers);
    setContextNodeDefinitions(details.nodeDefinitions || []);
    setContextVehicles(details.contextVehicles || []);
  };

  // Run Constraint Solver Dynamically
  const solverResult = useMemo(() => {
    return solveRelations(premises, basisRelations, dimension);
  }, [premises, basisRelations, dimension]);

  // Handle switching tabs
  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    // Flush sandbox coordinates when switching to sandbox vs training to keep contexts decoupled
    if (tab === 'sandbox') {
      setPremises([]);
      setDimension(2);
    }
  };

  // Quick helper to estimate fluid IQ metric
  const estimatedIQ = useMemo(() => {
    let baseIQ = 100;
    stats.history.forEach(h => {
      if (!h.correct) return;
      let weight = 1;
      if (h.difficulty === 'Intermediate') weight = 2.5;
      else if (h.difficulty === 'Advanced') weight = 5.5;
      else if (h.difficulty === 'Master') weight = 10;
      const speedFactor = h.timeMs < 25000 ? 1.2 : 1.0;
      baseIQ += weight * 0.4 * speedFactor;
    });
    return Math.min(160, Math.round(baseIQ));
  }, [stats.history]);

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] flex flex-col antialiased selection:bg-[#141414] selection:text-[#E4E3E0] font-sans md:border-8 border-[#141414]">
      
      {/* Upper Brand Info line */}
      <header className="border-b border-[#141414] bg-[#E4E3E0] sticky top-0 z-50 px-4 lg:px-8 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
          {/* Logo & Meta */}
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold tracking-tighter col-span-1">RRT.ENGINE</h1>
            <span className="font-serif italic text-sm opacity-60">Meta Relational Reasoning Training / v1.0.0</span>
          </div>

          {/* Quick HUD tracker */}
          <div className="flex flex-wrap items-center gap-4 text-xs font-sans">
            <div className="flex items-center gap-1.5 bg-white/60 border border-[#141414] px-3 py-1.5 font-bold">
              <Trophy className="w-3.5 h-3.5" />
              <span>Fluid IQ: <strong className="font-mono">{estimatedIQ}</strong></span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/60 border border-[#141414] px-3 py-1.5 font-bold">
              <Zap className="w-3.5 h-3.5" />
              <span>Streak: <strong className="font-mono">{stats.streak}</strong></span>
            </div>
            <div className="bg-[#141414] text-[#E4E3E0] px-3 py-1.5 text-[11px] font-mono leading-none tracking-wider uppercase font-bold">
              ENTITY_SYNC_OK
            </div>
          </div>
        </div>
      </header>

      {/* Main Container Dashboard */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 flex flex-col gap-6">
        
        {/* Sub-tabs workspace router */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 border-b border-[#141414] pb-4">
          <div className="flex flex-wrap gap-2">
            <button
              id="tab-training-btn"
              onClick={() => handleTabChange('training')}
              className={`flex items-center gap-2 px-4 py-2 border border-[#141414] text-xs font-sans font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
                activeTab === 'training'
                  ? 'bg-[#141414] text-[#E4E3E0]'
                  : 'bg-white/40 text-[#141414] hover:bg-[#141414]/10'
              }`}
            >
              <Brain className="w-4 h-4" />
              Relational Workouts
            </button>

            <button
              id="tab-sandbox-btn"
              onClick={() => handleTabChange('sandbox')}
              className={`flex items-center gap-2 px-4 py-2 border border-[#141414] text-xs font-sans font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
                activeTab === 'sandbox'
                  ? 'bg-[#141414] text-[#E4E3E0]'
                  : 'bg-white/40 text-[#141414] hover:bg-[#141414]/10'
              }`}
            >
              <Layers className="w-4 h-4" />
              Engine Sandbox
            </button>

            <button
              id="tab-analytics-btn"
              onClick={() => handleTabChange('analytics')}
              className={`flex items-center gap-2 px-4 py-2 border border-[#141414] text-xs font-sans font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
                activeTab === 'analytics'
                  ? 'bg-[#141414] text-[#E4E3E0]'
                  : 'bg-white/40 text-[#141414] hover:bg-[#141414]/10'
              }`}
            >
              <Activity className="w-4 h-4" />
              Neuro-Metrics
            </button>

            <button
              id="tab-manual-btn"
              onClick={() => handleTabChange('manual')}
              className={`flex items-center gap-2 px-4 py-2 border border-[#141414] text-xs font-sans font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
                activeTab === 'manual'
                  ? 'bg-[#141414] text-[#E4E3E0]'
                  : 'bg-white/40 text-[#141414] hover:bg-[#141414]/10'
              }`}
            >
              <FileText className="w-4 h-4" />
              Cognitive Manual
            </button>
          </div>

          <div className="text-[11px] text-[#141414] font-mono flex items-center gap-2 border border-[#141414] px-3 py-1.5 bg-white/50">
            <span className="w-2 h-2 rounded-full bg-green-600 animate-pulse"></span>
            <span>Current Canvas: <strong>{activeTab === 'training' && workoutMode === 'context' ? contextDimension : dimension}D Coordinate Matrix (I)</strong></span>
          </div>
        </div>

        {/* Dynamic Matrix Visualizer Split (Only shown for training/sandbox to represent spatial vectors) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* Action workspace left column */}
          <div className={`${activeTab === 'analytics' || activeTab === 'manual' ? 'lg:col-span-12' : 'lg:col-span-7'} flex flex-col gap-6`}>
            {activeTab === 'training' && (
              <TrainingWorkspace
                stats={stats}
                onUpdateStats={handleUpdateStats}
                basisRelations2D={getBasisRelations(2)}
                basisRelations3D={getBasisRelations(3)}
                basisRelations4D={getBasisRelations(4)}
                setDimension={setDimension}
                setSelectedPremises={setPremises}
                setHighlightedPremiseId={setHighlightedPremiseId}
                workoutMode={workoutMode}
                setWorkoutMode={setWorkoutMode}
                onUpdateContextDetails={handleUpdateContextDetails}
              />
            )}

            {activeTab === 'sandbox' && (
              <SandboxWorkspace
                dimension={dimension}
                setDimension={setDimension}
                premises={premises}
                setPremises={setPremises}
                basisRelations={basisRelations}
                onUpdateBasis={setBasisRelations}
                solverResult={solverResult}
                setHighlightedPremiseId={setHighlightedPremiseId}
              />
            )}

            {activeTab === 'analytics' && (
              <AnalyticsPanel
                stats={stats}
                onResetStats={handleResetStats}
              />
            )}

            {activeTab === 'manual' && (
              <div className="bg-white/80 border border-[#141414] p-6 lg:p-8 shadow-inner flex flex-col gap-6 relative overflow-hidden" id="cognitive-manual-panel">
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#141414 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
                
                <div className="flex items-center gap-3 border-b border-[#141414] pb-4 z-10">
                  <BookOpen className="w-6 h-6" />
                  <div>
                    <h2 className="font-sans font-bold text-xl text-[#141414] tracking-wide uppercase">Core Philosophy of RRT</h2>
                    <p className="text-xs opacity-60 font-serif italic">Relational Processing & Absolute Coordinate Modeling</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs text-[#141414] leading-relaxed font-sans z-10">
                  
                  <div className="flex flex-col gap-4">
                    <h3 className="font-sans font-bold text-[#141414] border-l-3 border-[#141414] pl-2 text-sm uppercase tracking-wider">What is Context-Shifting RRT?</h3>
                    <p>
                      <strong>Meta RRT</strong> is a dynamic relational reasoning paradigm where directional relationships are not static constraints. By treating relations themselves as mutable contexts, complexity scales exponentially through multi-variable context windows rather than a high working memory node-count.
                    </p>
                    <p>
                      Instead of tracking a long linear chain of static variables on a flat Euclidean grid, this paradigm forces cognitive branching and context gating. The user must isolate node relations, track simultaneous vector shifts across independent dimensions, and evaluate target projections across transformed spatial manifolds.
                    </p>
                    <h3 className="font-sans font-bold text-[#141414] border-l-3 border-[#141414] pl-2 text-sm uppercase tracking-wider">Vector Engine (Context Modifiers)</h3>
                    <p>
                      Every relationship maps as a directional vector where structural change can happen across a maximum of 4 dimensions [x, y, j, k]. When a context switch updates an axis, it registers as a linear modifier vector that is applied to the space:
                      <blockquote className="bg-[#141414]/5 rounded-none p-3 my-2 border-l-2 border-[#141414] text-[11px] font-mono whitespace-pre">
                        Context X is Before Context B (Inversion: -1)
Context Y is After Context C (Scaling: 1)
                      </blockquote>
                    </p>
                  </div>

                  <div className="flex flex-col gap-4">
                    <h3 className="font-sans font-bold text-[#141414] border-l-3 border-[#141414] pl-2 text-sm uppercase tracking-wider">Understanding the Dimensions</h3>
                    <div className="space-y-3.5">
                      <div className="bg-white/50 p-3 rounded-none border border-[#141414]/30">
                        <strong className="text-[#141414] block mb-0.5 font-mono uppercase tracking-tight text-[11px]">2D Flat Plane [North/South, East/West]</strong>
                        Standard cartesian coordination. Index 0 is North/South and index 1 is East/West. Perfect for basic cognitive calibration.
                      </div>
                      <div className="bg-white/50 p-3 rounded-none border border-[#141414]/30">
                        <strong className="text-[#141414] block mb-0.5 font-mono uppercase tracking-tight text-[11px]">3D Space Volume [North/South, East/West, Above/Below]</strong>
                        Adds vertical elevation. Direction vectors incorporate ABOVE / BELOW coordinate tracking as the 3rd index.
                      </div>
                      <div className="bg-white/50 p-3 rounded-none border border-[#141414]/30">
                        <strong className="text-[#141414] block mb-0.5 font-mono uppercase tracking-tight text-[11px]">4D Space [North/South, East/West, Above/Below, After/Before]</strong>
                        Relational reasoning incorporates <strong>AFTER</strong> ($+W$) and <strong>BEFORE</strong> ($-W$) as the 4th index.
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            )}
          </div>

          {/* Interactive visualizer right column */}
          {(activeTab === 'training' || activeTab === 'sandbox') && (
            <div className="lg:col-span-5 flex flex-col h-full self-stretch min-h-[400px]">
              {activeTab === 'training' && workoutMode === 'context' ? (
                <ContextProjector
                  dimension={contextDimension}
                  baseVector={contextBaseVector}
                  projectedVector={contextProjectedVector}
                  baseRelationName={contextBaseRelationName}
                  projectedRelationName={contextProjectedRelationName}
                  activeModifiers={contextActiveModifiers}
                  nodeDefinitions={contextNodeDefinitions}
                  contextVehicles={contextVehicles}
                />
              ) : (
                <Visualizer
                  entities={solverResult.entities}
                  premises={premises}
                  dimension={dimension}
                  basisRelations={basisRelations}
                  highlightedPremiseId={highlightedPremiseId}
                />
              )}
            </div>
          )}

        </div>

      </main>

      {/* Page bottom styling margin footer */}
      <footer className="border-t border-[#141414] bg-[#141414] py-5 text-center text-[10px] text-[#E4E3E0] font-mono mt-auto relative z-10 uppercase tracking-wider">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <span>RRT Neural Framework • Active Engine Module V1.0 (Identity Matrix)</span>
          <span className="flex items-center gap-1.5">
            <Network className="w-3.5 h-3.5" />
            Designed to push fluid IQ limits using absolute dimensional vector projection.
          </span>
        </div>
      </footer>

    </div>
  );
}

// Simple BookOpen helper since we need manual manual icons
function BookOpen(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}
