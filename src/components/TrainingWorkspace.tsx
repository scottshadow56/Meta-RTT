import React, { useState, useEffect, useRef } from 'react';
import { DimensionCount, Puzzle, PuzzleDifficulty, TrainingStats } from '../types';
import { generateTrainerPuzzle, getBasisRelations, generateUniqueCVCNames } from '../utils/engine';
import { 
  Brain, Trophy, Clock, ShieldCheck, HelpCircle, 
  ArrowRight, RotateCw, Activity, Compass, Sliders 
} from 'lucide-react';

interface ContextOption {
  text: string;
  isCorrect: boolean;
}

interface ContextPuzzle {
  dimension: DimensionCount;
  difficulty: PuzzleDifficulty;
  nodeDefinitions: {
    node: string;
    relation: string;
    targetNode: string;
    baseOffset: number[];
  }[];
  contextVehicles: {
    id: string; 
    boundRelation: string; 
    boundNode: string; 
    boundVector: number[];
    shiftMultiplier: number; 
    shiftLabel: string; 
    axisIndex?: number;
    effectiveMultiplier?: number;
  }[];
  activeContextGroup: string[]; 
  queryNode: string; 
  queryTarget: string; 
  baseOffsetVector: number[]; 
  projectedVector: number[]; 
  baseRelation: string; 
  projectedRelation: string; 
  options: ContextOption[];
}

interface TrainingWorkspaceProps {
  stats: TrainingStats;
  onUpdateStats: (newStats: TrainingStats) => void;
  basisRelations2D: Record<string, number[]>;
  basisRelations3D: Record<string, number[]>;
  basisRelations4D: Record<string, number[]>;
  setDimension: (dim: DimensionCount) => void;
  setSelectedPremises: (premises: any[]) => void;
  setHighlightedPremiseId: (id: string | null) => void;
  workoutMode: 'classic' | 'context';
  setWorkoutMode: (mode: 'classic' | 'context') => void;
  onUpdateContextDetails: (details: {
    dimension: DimensionCount;
    baseVector: number[];
    projectedVector: number[];
    baseRelationName: string;
    projectedRelationName: string;
    activeModifiers: number[];
    nodeDefinitions: any[];
    contextVehicles: any[];
    queryNode?: string;
    queryTarget?: string;
  }) => void;
  isSubmitted: boolean;
  setIsSubmitted: (isSub: boolean) => void;
}

const describeContextVector = (vec: number[], dim: DimensionCount): string => {
  const parts: string[] = [];
  const y = vec[0] ?? 0;
  const x = vec[1] ?? 0;
  
  let gridPart = '';
  if (y > 0) gridPart += 'North';
  else if (y < 0) gridPart += 'South';
  if (x > 0) gridPart += 'East';
  else if (x < 0) gridPart += 'West';
  
  if (gridPart) {
    if (Math.abs(y) > 1 || Math.abs(x) > 1) {
      gridPart += '-Scaled';
    }
    parts.push(gridPart);
  }
  
  if (dim >= 3) {
    const z = vec[2] ?? 0;
    if (z > 0) {
      parts.push(Math.abs(z) > 1 ? 'Above-Scaled' : 'Above');
    } else if (z < 0) {
      parts.push(Math.abs(z) > 1 ? 'Below-Scaled' : 'Below');
    }
  }
  
  if (dim >= 4) {
    const w = vec[3] ?? 0;
    if (w > 0) {
      parts.push(Math.abs(w) > 1 ? 'After-Scaled' : 'After');
    } else if (w < 0) {
      parts.push(Math.abs(w) > 1 ? 'Before-Scaled' : 'Before');
    }
  }
  
  if (parts.length === 0) return 'Origin';
  return parts.join('-');
};

export function generateContextPuzzle(
  dim: DimensionCount,
  difficulty: PuzzleDifficulty,
  customSettings?: {
    useCustom: boolean;
    anchorCount: number;
    shiftsPerAnchor: number;
    interrelation: 'chain' | 'cross';
    scaleType: 'integer' | 'mixed';
    activeContextsCount?: string | number;
    scrambleSetting?: 'none' | 'partial' | 'full';
    contextType?: 'premises' | 'inferences' | 'both';
  }
): ContextPuzzle {
  const getRandomOffset = (d: number): number[] => {
    const out: any[] = [0, 0, 0, 0];
    const choices = [-1, 0, 1];
    for (let i = 0; i < d; i++) {
      if (i === 3) {
        // 4D Space: Make "after" (+w) extremely rare (less than 8%, e.g. 6.5%)
        const r = Math.random();
        if (r < 0.065) {
          out[i] = 1; // "After"
        } else if (r < 0.50) {
          out[i] = -1; // "Before"
        } else {
          out[i] = 0;
        }
      } else {
        out[i] = choices[Math.floor(Math.random() * choices.length)];
      }
    }
    if (out.slice(0, d).every(v => v === 0)) {
      out[0] = 1;
    }
    return out;
  };

  // Dynamic node & offset generator up to 12 anchors
  const maxNodesNeeded = (customSettings && customSettings.useCustom)
    ? Math.max(5, (customSettings.anchorCount || 0) + 1)
    : (dim >= 4 ? 5 : (dim === 3 ? 4 : 3));

  const itemNames = generateUniqueCVCNames(maxNodesNeeded);
  const backups = generateUniqueCVCNames(10).filter(n => !itemNames.includes(n));
  const GammaName = itemNames[0];
  const BetaName = itemNames[1] || backups[0];
  const AlphaName = itemNames[2] || backups[1];
  const DeltaName = itemNames[3] || backups[2];
  const OmegaName = itemNames[4] || backups[3];

  const nodesCoords: Record<string, number[]> = {
    [GammaName]: [0, 0, 0, 0]
  };

  const connectedNodes = [GammaName];
  const remainingNodes = itemNames.slice(1);
  const rawGeneratedAxes: { boundNode: string; boundVector: number[]; boundName: string; targetNode: string; isImplicit: boolean }[] = [];

  while (remainingNodes.length > 0) {
    let parentIndex = 0;
    const nextChildIndex = connectedNodes.length;
    if (nextChildIndex === 1) {
      parentIndex = 0; // Beta relative to Gamma
    } else if (nextChildIndex === 2) {
      parentIndex = 1; // Alpha relative to Beta
    } else if (nextChildIndex === 3) {
      parentIndex = 0; // Delta relative to Gamma
    } else if (nextChildIndex === 4) {
      parentIndex = 2; // Omega relative to Alpha
    } else {
      parentIndex = Math.floor(Math.random() * connectedNodes.length);
    }

    const parent = connectedNodes[parentIndex];
    const child = remainingNodes.shift()!;
    const offset = getRandomOffset(dim);
    const parentCoords = nodesCoords[parent];

    nodesCoords[child] = [
      parentCoords[0] + offset[0],
      parentCoords[1] + offset[1],
      parentCoords[2] + offset[2],
      parentCoords[3] + offset[3]
    ];
    connectedNodes.push(child);

    rawGeneratedAxes.push({
      boundNode: child,
      boundVector: offset,
      boundName: describeContextVector(offset, dim),
      targetNode: parent,
      isImplicit: false
    });
  }

  const poolOfItems = connectedNodes;

  // Pick random query pair out of defined vectors
  let qIdx1 = Math.floor(Math.random() * poolOfItems.length);
  let qIdx2 = Math.floor(Math.random() * poolOfItems.length);
  while (qIdx1 === qIdx2) {
    qIdx2 = Math.floor(Math.random() * poolOfItems.length);
  }
  const queryNode = poolOfItems[qIdx1];
  const queryTarget = poolOfItems[qIdx2];

  const baseOffsetVector = [
    nodesCoords[queryNode][0] - nodesCoords[queryTarget][0],
    nodesCoords[queryNode][1] - nodesCoords[queryTarget][1],
    nodesCoords[queryNode][2] - nodesCoords[queryTarget][2],
    nodesCoords[queryNode][3] - nodesCoords[queryTarget][3],
  ];

  if (baseOffsetVector.slice(0, dim).every(v => v === 0)) {
    baseOffsetVector[0] = 1;
  }

  const contextVehicles: any[] = [];
  const activeContextGroup: string[] = [];

  // Track explicit relations
  const premisePairs = new Set<string>();
  rawGeneratedAxes.forEach(ax => {
    premisePairs.add(`${ax.boundNode}::${ax.targetNode}`);
    premisePairs.add(`${ax.targetNode}::${ax.boundNode}`);
  });

  // Generate list of all possible implicit (inference) relations on the active map
  const inferencePairs: { boundNode: string; targetNode: string; boundVector: number[]; boundName: string; isImplicit: boolean }[] = [];
  for (let i = 0; i < poolOfItems.length; i++) {
    for (let j = 0; j < poolOfItems.length; j++) {
      if (i === j) continue;
      const u = poolOfItems[i];
      const v = poolOfItems[j];
      const key = `${u}::${v}`;
      if (!premisePairs.has(key)) {
        const vec = [
          nodesCoords[u][0] - nodesCoords[v][0],
          nodesCoords[u][1] - nodesCoords[v][1],
          nodesCoords[u][2] - nodesCoords[v][2],
          nodesCoords[u][3] - nodesCoords[v][3],
        ];
        if (!vec.slice(0, dim).every(val => val === 0)) {
          inferencePairs.push({
            boundNode: u,
            targetNode: v,
            boundVector: vec,
            boundName: describeContextVector(vec, dim),
            isImplicit: true
          });
        }
      }
    }
  }

  const baseRawAxes = rawGeneratedAxes;

  // Decide dynamically per slot if we mutate/swap it to be an implicit inference axis!
  const finalAxes: typeof baseRawAxes = [];
  const mutableInferences = [...inferencePairs];
  const contextType = customSettings?.contextType ?? 'both';

  for (let i = 0; i < baseRawAxes.length; i++) {
    if (contextType === 'inferences') {
      if (mutableInferences.length > 0) {
        const idx = Math.floor(Math.random() * mutableInferences.length);
        finalAxes.push(mutableInferences.splice(idx, 1)[0]);
      } else {
        finalAxes.push(baseRawAxes[i]);
      }
    } else if (contextType === 'premises') {
      finalAxes.push(baseRawAxes[i]);
    } else {
      // both (mix) -> 50% chance of swap with implicit inference relation
      if (mutableInferences.length > 0 && Math.random() < 0.5) {
        const idx = Math.floor(Math.random() * mutableInferences.length);
        const chosenInf = mutableInferences.splice(idx, 1)[0];
        finalAxes.push(chosenInf);
      } else {
        finalAxes.push(baseRawAxes[i]);
      }
    }
  }

  const axes = finalAxes;

  // Wording text builder helper
  const makeVehicleText = (cv: any, parentId?: string): string => {
    if (cv.isAnchor) {
      // 70% Independent context preference: (context A is defined as northeast and above)
      // 30% Relational context: (Context A is the relation of item1 and item2)
      if (Math.random() > 0.7) {
        const i1 = cv.boundNode || BetaName;
        const i2 = cv.targetNode || GammaName;
        return `Context ${cv.id} is the relation of ${i1} and ${i2}`;
      } else {
        return `Context ${cv.id} is defined as ${cv.boundRelation.toLowerCase()}`;
      }
    } else {
      // Shift representation: preferring "context B shifts after in Context A"
      const shiftWord = cv.shiftMultiplier > 0 ? 'after' : 'before';
      if (Math.random() > 0.35) {
        return `Context ${cv.id} shifts ${shiftWord} in Context ${parentId}`;
      } else {
        return `Context ${cv.id} is ${shiftWord === 'after' ? 'After' : 'Before'} context ${parentId}`;
      }
    }
  };

  // Tracking effective multipliers on each axis to absolutely prevent unchanged clone duplicate identity context
  const currentAxisMults: Record<number, Set<number>> = {};
  for (let i = 0; i < axes.length; i++) {
    currentAxisMults[i] = new Set<number>([1]); // 1 is identical (base/unchanged context)
  }

  const getValidMultiplier = (axisIndex: number, parentEff: number): number => {
    const pool = [2, -1, -2]; // Only integers to remove mixed scales
    const valid = pool.filter(m => {
      const prospective = parentEff * m;
      if (prospective === 1) return false; // Unchanged duplicated identity
      if (Math.abs(prospective) > 2) return false; // Magnitude constraint
      if (currentAxisMults[axisIndex].has(prospective)) return false; // No duplications
      return true;
    });
    if (valid.length > 0) return valid[Math.floor(Math.random() * valid.length)];
    
    // Final safe fallback that tries to search for another unique value (e.g. including -2 or 2 or negative sign swaps)
    for (const fallback of [-1, 2, -2]) {
      const prospective = parentEff * fallback;
      if (prospective !== 1 && !currentAxisMults[axisIndex].has(prospective)) {
        return fallback;
      }
    }
    return -1; // safe default
  };

  const applyVectorTransform = (
    parentVec: number[],
    parentMults: number[],
    opFactor: number,
    crossVec?: number[]
  ) => {
    const nextMults = [...parentMults];
    const nextVec = [...parentVec];
    for (let i = 0; i < 4; i++) {
      const parentVal = parentVec[i] || 0;
      const shouldTransform = crossVec
        ? (parentVal !== 0 && (crossVec[i] || 0) !== 0)
        : (parentVal !== 0);

      if (shouldTransform) {
        nextMults[i] = parentMults[i] * opFactor;
        nextVec[i] = parentVal * opFactor;
      }
    }
    return { axisMultipliers: nextMults, representedVector: nextVec };
  };

  if (customSettings && customSettings.useCustom) {
    const { anchorCount, shiftsPerAnchor, interrelation } = customSettings;
    const actualAnchorsCount = Math.min(anchorCount, axes.length);

    const levels: any[][] = [];
    levels[0] = [];

    const assignedNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    let nameIdx = 0;

    for (let i = 0; i < actualAnchorsCount; i++) {
      const name = assignedNames[nameIdx++];
      const targetNode = axes[i].targetNode || GammaName;
      const nodeName = axes[i].boundNode;
      const anchorObj = {
        id: name,
        boundRelation: axes[i].boundName,
        boundNode: axes[i].boundNode,
        boundVector: axes[i].boundVector,
        shiftMultiplier: 1,
        shiftLabel: `${nodeName}::${targetNode}`,
        axisIndex: i,
        effectiveMultiplier: 1,
        isAnchor: true,
        text: `Context ${name} = ${nodeName}::${targetNode}`,
        axisMultipliers: [1, 1, 1, 1],
        representedVector: [...axes[i].boundVector]
      };
      anchorObj.axisMultipliers[i] = 1;
      contextVehicles.push(anchorObj);
      levels[0].push(anchorObj);
    }

    for (let j = 1; j <= shiftsPerAnchor; j++) {
      levels[j] = [];
      for (let i = 0; i < actualAnchorsCount; i++) {
        if (nameIdx >= assignedNames.length) break;
        const name = assignedNames[nameIdx++];
        
        const parent = levels[j - 1][i];
        const isScale = Math.random() < 0.05;
        const opFactor = isScale ? 2 : -1;
        const opName = isScale ? 'Scale' : 'Invert';
        
        const shiftObj: any = {
          id: name,
          boundRelation: parent.boundRelation,
          boundNode: parent.boundNode,
          boundVector: parent.boundVector,
          shiftMultiplier: opFactor,
          axisIndex: parent.axisIndex,
          effectiveMultiplier: parent.effectiveMultiplier * opFactor,
          isAnchor: false,
          shiftLabel: `${opName}(${parent.id})`,
          text: `Context ${name} = ${opName}(${parent.id})`,
          axisMultipliers: [1, 1, 1, 1],
          representedVector: [0, 0, 0, 0]
        };
        
        const crossAnchor = (interrelation === 'cross' && actualAnchorsCount > 1)
          ? levels[0][(parent.axisIndex + 1) % actualAnchorsCount]
          : undefined;

        if (crossAnchor) {
          shiftObj.shiftLabel = `${opName}(${parent.id}) in Context ${crossAnchor.id}`;
          shiftObj.text = `Context ${name} = ${opName}(${parent.id}) in Context ${crossAnchor.id}`;
        }

        const { axisMultipliers, representedVector } = applyVectorTransform(
          parent.representedVector,
          parent.axisMultipliers,
          opFactor,
          crossAnchor ? crossAnchor.representedVector : undefined
        );
        shiftObj.axisMultipliers = axisMultipliers;
        shiftObj.representedVector = representedVector;
        
        contextVehicles.push(shiftObj);
        levels[j].push(shiftObj);
      }
    }

    const leafLevel = levels[shiftsPerAnchor] || levels[0];
    leafLevel.forEach(cv => {
      activeContextGroup.push(cv.id);
    });

  } else {
    if (difficulty === 'Beginner') {
      const nodeA = axes[0].boundNode;
      const nodeTarget = axes[0].targetNode || GammaName;
      
      const anchor = {
        id: 'A',
        boundRelation: axes[0].boundName,
        boundNode: axes[0].boundNode,
        boundVector: axes[0].boundVector,
        shiftMultiplier: 1,
        shiftLabel: `${nodeA}::${nodeTarget}`,
        axisIndex: 0,
        effectiveMultiplier: 1,
        isAnchor: true,
        text: `Context A = ${nodeA}::${nodeTarget}`,
        axisMultipliers: [1, 1, 1, 1],
        representedVector: [...axes[0].boundVector]
      };
      contextVehicles.push(anchor);

      const isBScale = Math.random() < 0.05;
      const bMult = isBScale ? 2 : -1;
      
      const transformB = applyVectorTransform(anchor.representedVector, anchor.axisMultipliers, bMult);

      const shiftB = {
        id: 'B',
        boundRelation: axes[0].boundName,
        boundNode: axes[0].boundNode,
        boundVector: axes[0].boundVector,
        shiftMultiplier: bMult,
        shiftLabel: isBScale ? 'Scale(A)' : 'Invert(A)',
        axisIndex: 0,
        effectiveMultiplier: bMult,
        isAnchor: false,
        text: isBScale ? 'Context B = Scale(A)' : 'Context B = Invert(A)',
        ...transformB
      };
      contextVehicles.push(shiftB);

      activeContextGroup.push('B');

    } else if (difficulty === 'Intermediate') {
      const nodeA = axes[0].boundNode;
      const nodeTarget = axes[0].targetNode || GammaName;
      
      const anchor = {
        id: 'A',
        boundRelation: axes[0].boundName,
        boundNode: axes[0].boundNode,
        boundVector: axes[0].boundVector,
        shiftMultiplier: 1,
        shiftLabel: `${nodeA}::${nodeTarget}`,
        axisIndex: 0,
        effectiveMultiplier: 1,
        isAnchor: true,
        text: `Context A = ${nodeA}::${nodeTarget}`,
        axisMultipliers: [1, 1, 1, 1],
        representedVector: [...axes[0].boundVector]
      };
      contextVehicles.push(anchor);

      const isBScale = Math.random() < 0.05;
      const bMult = isBScale ? 2 : -1;

      const transformB = applyVectorTransform(anchor.representedVector, anchor.axisMultipliers, bMult);

      const shiftB = {
        id: 'B',
        boundRelation: axes[0].boundName,
        boundNode: axes[0].boundNode,
        boundVector: axes[0].boundVector,
        shiftMultiplier: bMult,
        shiftLabel: isBScale ? 'Scale(A)' : 'Invert(A)',
        axisIndex: 0,
        effectiveMultiplier: bMult,
        isAnchor: false,
        text: isBScale ? 'Context B = Scale(A)' : 'Context B = Invert(A)',
        ...transformB
      };
      contextVehicles.push(shiftB);

      const isCScale = Math.random() < 0.05;
      const cMult = isCScale ? 2 : -1;
      const transformC = applyVectorTransform(shiftB.representedVector, shiftB.axisMultipliers, cMult);

      const shiftC = {
        id: 'C',
        boundRelation: axes[0].boundName,
        boundNode: axes[0].boundNode,
        boundVector: axes[0].boundVector,
        shiftMultiplier: cMult,
        shiftLabel: isCScale ? 'Scale(B)' : 'Invert(B)',
        axisIndex: 0,
        effectiveMultiplier: bMult * cMult,
        isAnchor: false,
        text: isCScale ? 'Context C = Scale(B)' : 'Context C = Invert(B)',
        ...transformC
      };
      contextVehicles.push(shiftC);

      activeContextGroup.push('C');

    } else if (difficulty === 'Advanced') {
      const nodeA = axes[0].boundNode;
      const nodeB = axes[1].boundNode;
      const nodeTarget = axes[0].targetNode || GammaName;
      const nodeTargetB = axes[1].targetNode || GammaName;

      const anchorA = {
        id: 'A',
        boundRelation: axes[0].boundName,
        boundNode: axes[0].boundNode,
        boundVector: axes[0].boundVector,
        shiftMultiplier: 1,
        shiftLabel: `${nodeA}::${nodeTarget}`,
        axisIndex: 0,
        effectiveMultiplier: 1,
        isAnchor: true,
        text: `Context A = ${nodeA}::${nodeTarget}`,
        axisMultipliers: [1, 1, 1, 1],
        representedVector: [...axes[0].boundVector]
      };
      contextVehicles.push(anchorA);

      const anchorB = {
        id: 'B',
        boundRelation: axes[1].boundName,
        boundNode: axes[1].boundNode,
        boundVector: axes[1].boundVector,
        shiftMultiplier: 1,
        shiftLabel: `${nodeB}::${nodeTargetB}`,
        axisIndex: 1,
        effectiveMultiplier: 1,
        isAnchor: true,
        text: `Context B = ${nodeB}::${nodeTargetB}`,
        axisMultipliers: [1, 1, 1, 1],
        representedVector: [...axes[1].boundVector]
      };
      contextVehicles.push(anchorB);

      const transformC = applyVectorTransform(anchorB.representedVector, anchorB.axisMultipliers, -1, anchorA.representedVector);

      const shiftC = {
        id: 'C',
        boundRelation: axes[1].boundName,
        boundNode: axes[1].boundNode,
        boundVector: axes[1].boundVector,
        shiftMultiplier: -1,
        shiftLabel: 'Invert(B) in Context A',
        axisIndex: 1,
        effectiveMultiplier: -1,
        isAnchor: false,
        text: 'Context C = Invert(B) in Context A',
        ...transformC
      };
      contextVehicles.push(shiftC);

      activeContextGroup.push('C');

    } else {
      const nodeA = axes[0].boundNode;
      const nodeB = axes[1].boundNode;
      const nodeTarget = axes[0].targetNode || GammaName;
      const nodeTargetB = axes[1].targetNode || GammaName;

      const anchorA = {
        id: 'A',
        boundRelation: axes[0].boundName,
        boundNode: axes[0].boundNode,
        boundVector: axes[0].boundVector,
        shiftMultiplier: 1,
        shiftLabel: `${nodeA}::${nodeTarget}`,
        axisIndex: 0,
        effectiveMultiplier: 1,
        isAnchor: true,
        text: `Context A = ${nodeA}::${nodeTarget}`,
        axisMultipliers: [1, 1, 1, 1],
        representedVector: [...axes[0].boundVector]
      };
      contextVehicles.push(anchorA);

      const anchorB = {
        id: 'B',
        boundRelation: axes[1].boundName,
        boundNode: axes[1].boundNode,
        boundVector: axes[1].boundVector,
        shiftMultiplier: 1,
        shiftLabel: `${nodeB}::${nodeTargetB}`,
        axisIndex: 1,
        effectiveMultiplier: 1,
        isAnchor: true,
        text: `Context B = ${nodeB}::${nodeTargetB}`,
        axisMultipliers: [1, 1, 1, 1],
        representedVector: [...axes[1].boundVector]
      };
      contextVehicles.push(anchorB);

      const isCScale = Math.random() < 0.05;
      const cMult = isCScale ? 2 : -1;

      const transformC = applyVectorTransform(anchorA.representedVector, anchorA.axisMultipliers, cMult);

      const shiftC = {
        id: 'C',
        boundRelation: axes[0].boundName,
        boundNode: axes[0].boundNode,
        boundVector: axes[0].boundVector,
        shiftMultiplier: cMult,
        shiftLabel: isCScale ? 'Scale(A)' : 'Invert(A)',
        axisIndex: 0,
        effectiveMultiplier: cMult,
        isAnchor: false,
        text: isCScale ? 'Context C = Scale(A)' : 'Context C = Invert(A)',
        ...transformC
      };
      contextVehicles.push(shiftC);

      const isDScale = Math.random() < 0.05;
      const dMult = isDScale ? 2 : -1;

      const transformD = applyVectorTransform(shiftC.representedVector, shiftC.axisMultipliers, dMult, anchorB.representedVector);

      const shiftD = {
        id: 'D',
        boundRelation: axes[1].boundName,
        boundNode: axes[1].boundNode,
        boundVector: axes[1].boundVector,
        shiftMultiplier: dMult,
        shiftLabel: isDScale ? 'Scale(C) in Context B' : 'Invert(C) in Context B',
        axisIndex: 1,
        effectiveMultiplier: dMult,
        isAnchor: false,
        text: isDScale ? 'Context D = Scale(C) in Context B' : 'Context D = Invert(C) in Context B',
        ...transformD
      };
      contextVehicles.push(shiftD);

      activeContextGroup.push('D');
    }
  }

  // Randomly select a subset combination of non-anchor context vehicles, ensuring it's not a direct relative vector (anchor)
  const nonAnchorCandidates = contextVehicles.filter(cv => !cv.isAnchor);
  if (nonAnchorCandidates.length > 0) {
    activeContextGroup.length = 0; // Clear traditional defaults
    // Grab a random or configured amount of elements
    let countToSelect = Math.floor(Math.random() * nonAnchorCandidates.length) + 1;
    
    if (customSettings?.activeContextsCount !== undefined) {
      const cfg = customSettings.activeContextsCount;
      if (cfg === 'eq1') {
        countToSelect = 1;
      } else if (cfg === 'lte2') {
        const mx = Math.min(2, nonAnchorCandidates.length);
        countToSelect = Math.floor(Math.random() * mx) + 1;
      } else if (cfg === 'lte3') {
        const mx = Math.min(3, nonAnchorCandidates.length);
        countToSelect = Math.floor(Math.random() * mx) + 1;
      } else if (cfg === 'lte4') {
        const mx = Math.min(4, nonAnchorCandidates.length);
        countToSelect = Math.floor(Math.random() * mx) + 1;
      } else if (typeof cfg === 'number' && cfg > 0) {
        countToSelect = Math.min(cfg, nonAnchorCandidates.length);
      }
    }

    let selectedVehicles: any[] = [];
    if (countToSelect === 1) {
      // Clean, elegant constraint: always select the last context shift produced
      const lastShift = nonAnchorCandidates[nonAnchorCandidates.length - 1];
      selectedVehicles = [lastShift];
    } else {
      const shuffledNonAnchors = [...nonAnchorCandidates].sort(() => Math.random() - 0.5);
      selectedVehicles = shuffledNonAnchors.slice(0, countToSelect);
    }

    // Sort alphabetically by id to keep letters (like BCD, JKL) nicely presented in final display
    selectedVehicles.sort((a, b) => a.id.localeCompare(b.id));
    selectedVehicles.forEach(cv => {
      activeContextGroup.push(cv.id);
    });
  }

  const aggregateScales = [1, 1, 1, 1];
  contextVehicles.forEach(cv => {
    if (activeContextGroup.includes(cv.id)) {
      for (let idx = 0; idx < dim; idx++) {
        if (cv.axisMultipliers && cv.axisMultipliers[idx] !== undefined) {
          aggregateScales[idx] *= cv.axisMultipliers[idx];
        } else {
          // fallback
          const scaleFactor = cv.effectiveMultiplier !== undefined ? cv.effectiveMultiplier : cv.shiftMultiplier;
          if (cv.boundVector[idx] !== 0) {
            aggregateScales[idx] *= scaleFactor;
          }
        }
      }
    }
  });

  const projectedVector = [
    baseOffsetVector[0] * aggregateScales[0],
    baseOffsetVector[1] * aggregateScales[1],
    baseOffsetVector[2] * aggregateScales[2],
    baseOffsetVector[3] * aggregateScales[3],
  ];

  if (projectedVector.slice(0, dim).every(v => v === 0)) {
    projectedVector[0] = 1;
  }

  const baseRelation = describeContextVector(baseOffsetVector, dim);
  const projectedRelation = describeContextVector(projectedVector, dim);

  const correctOptionText = projectedRelation;
  const incorrectChoices = new Set<string>();

  if (baseRelation !== correctOptionText) {
    incorrectChoices.add(baseRelation);
  }

  const cardinalDistractors = [
    'North', 'South', 'East', 'West', 'Northeast', 'Northwest', 'Southeast', 'Southwest',
    'North-Above', 'South-Below', 'Northeast-Above', 'Southwest-Below', 
    'North-Scaled', 'South-Above-Scaled', 'East-After', 'West-Before',
    'North-After', 'South-Before', 'Northeast-After', 'Southwest-Before-Scaled'
  ];

  while (incorrectChoices.size < 3) {
    const randChoice = cardinalDistractors[Math.floor(Math.random() * cardinalDistractors.length)];
    if (randChoice !== correctOptionText && randChoice !== 'Origin') {
      incorrectChoices.add(randChoice);
    }
  }

  const options = [
    { text: correctOptionText, isCorrect: true },
    ...Array.from(incorrectChoices).map(txt => ({ text: txt, isCorrect: false }))
  ].sort(() => Math.random() - 0.5);

  const nodeDefinitions = rawGeneratedAxes.map(ax => ({
    node: ax.boundNode,
    relation: describeContextVector(ax.boundVector, dim),
    targetNode: ax.targetNode,
    baseOffset: ax.boundVector
  }));

  // Shuffle/scramble the premises according to the scramble setting
  const scramble = customSettings?.scrambleSetting ?? 'full';
  if (scramble === 'full') {
    nodeDefinitions.sort(() => Math.random() - 0.5);
  } else if (scramble === 'partial') {
    // Only shuffle 40% of the time, or swap the first two
    if (Math.random() < 0.4) {
      nodeDefinitions.sort(() => Math.random() - 0.5);
    } else if (nodeDefinitions.length >= 2) {
      const temp = nodeDefinitions[0];
      nodeDefinitions[0] = nodeDefinitions[1];
      nodeDefinitions[1] = temp;
    }
  } else {
    // scramble === 'none': enforce original stable logical/generation order
  }

  return {
    dimension: dim,
    difficulty,
    nodeDefinitions,
    contextVehicles,
    activeContextGroup,
    queryNode,
    queryTarget,
    baseOffsetVector,
    projectedVector,
    baseRelation,
    projectedRelation,
    options
  };
}

export default function TrainingWorkspace({
  stats,
  onUpdateStats,
  setDimension,
  setSelectedPremises,
  setHighlightedPremiseId,
  workoutMode,
  setWorkoutMode,
  onUpdateContextDetails,
  isSubmitted,
  setIsSubmitted
}: TrainingWorkspaceProps) {
  const [selectedDim, setSelectedDim] = useState<DimensionCount>(2);
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>('Beginner');

  // Custom configuration states
  const [generatorMode, setGeneratorMode] = useState<'preset' | 'custom'>('preset');
  const [customAnchors, setCustomAnchors] = useState<number>(2);
  const [customShiftsCount, setCustomShiftsCount] = useState<number>(2);
  const [customInterrelation, setCustomInterrelation] = useState<'chain' | 'cross'>('chain');
  const [customActiveCount, setCustomActiveCount] = useState<string | number>('random');
  const [scrambleSetting, setScrambleSetting] = useState<'none' | 'partial' | 'full'>('full');
  const [contextType, setContextType] = useState<'premises' | 'inferences' | 'both'>('both');
  
  const [currentPuzzle, setCurrentPuzzle] = useState<Puzzle | null>(null);
  const [selectedAnswerIdx, setSelectedAnswerIdx] = useState<number | null>(null);

  const [currentCtxPuzzle, setCurrentCtxPuzzle] = useState<ContextPuzzle | null>(null);
  const [selectedCtxAnswerIdx, setSelectedCtxAnswerIdx] = useState<number | null>(null);
  const [showCtxExplanation, setShowCtxExplanation] = useState<boolean>(false);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [seconds, setSeconds] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleStartTraining = () => {
    setIsPlaying(true);
    setDimension(selectedDim);
    setShowCtxExplanation(false);

    if (workoutMode === 'classic') {
      const useCustomParams = generatorMode === 'custom';
      const customNodeCount = useCustomParams ? (customAnchors + 1) : undefined;
      const customScrambleSetting = useCustomParams ? scrambleSetting : undefined;
      const newPuzzle = generateTrainerPuzzle(selectedDim, difficulty, customNodeCount, customScrambleSetting);
      const visualPremises = newPuzzle.premises.map((p, idx) => ({
        id: `pzp-${idx}`,
        entityA: p.entityA,
        relation: p.relation,
        entityB: p.entityB
      }));
      setSelectedPremises(visualPremises);
      setHighlightedPremiseId(null);
      setCurrentPuzzle(newPuzzle);
      setSelectedAnswerIdx(null);
      setIsSubmitted(false);
      setSeconds(0);
    } else {
      const newCtxPuzzle = generateContextPuzzle(selectedDim, difficulty, {
        useCustom: generatorMode === 'custom',
        anchorCount: customAnchors,
        shiftsPerAnchor: customShiftsCount,
        interrelation: customInterrelation,
        scaleType: 'integer',
        activeContextsCount: customActiveCount,
        scrambleSetting: scrambleSetting,
        contextType: contextType
      });
      setCurrentCtxPuzzle(newCtxPuzzle);
      setSelectedCtxAnswerIdx(null);
      setIsSubmitted(false);
      setSeconds(0);

      onUpdateContextDetails({
        dimension: selectedDim,
        baseVector: newCtxPuzzle.baseOffsetVector,
        projectedVector: newCtxPuzzle.projectedVector,
        baseRelationName: newCtxPuzzle.baseRelation,
        projectedRelationName: newCtxPuzzle.projectedRelation,
        nodeDefinitions: newCtxPuzzle.nodeDefinitions,
        contextVehicles: newCtxPuzzle.contextVehicles,
        queryNode: newCtxPuzzle.queryNode,
        queryTarget: newCtxPuzzle.queryTarget,
        activeModifiers: (() => {
          const aggregateScales = [1, 1, 1, 1];
          newCtxPuzzle.contextVehicles.forEach(cv => {
            if (newCtxPuzzle.activeContextGroup.includes(cv.id)) {
              const scaleFactor = cv.effectiveMultiplier !== undefined ? cv.effectiveMultiplier : cv.shiftMultiplier;
              for (let idx = 0; idx < selectedDim; idx++) {
                if (cv.boundVector[idx] !== 0) {
                  aggregateScales[idx] *= scaleFactor;
                }
              }
            }
          });
          return aggregateScales;
        })()
      });
    }
  };

  useEffect(() => {
    if (isPlaying) {
      handleStartTraining();
    }
  }, [
    selectedDim,
    difficulty,
    workoutMode,
    generatorMode,
    customAnchors,
    customShiftsCount,
    customInterrelation,
    customActiveCount,
    scrambleSetting,
    contextType
  ]);

  useEffect(() => {
    const isOver = isSubmitted;
    if (isPlaying && !isOver) {
      timerRef.current = setInterval(() => {
        setSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, isSubmitted]);

  const handleSelectAnswer = (idx: number) => {
    if (isSubmitted) return;
    if (workoutMode === 'classic') {
      setSelectedAnswerIdx(idx);
    } else {
      setSelectedCtxAnswerIdx(idx);
    }
  };

  const handleSubmitAnswer = () => {
    if (workoutMode === 'classic') {
      if (selectedAnswerIdx === null || isSubmitted || !currentPuzzle) return;
      
      setIsSubmitted(true);
      const selectedOption = currentPuzzle.options[selectedAnswerIdx];
      const isCorrect = selectedOption.isCorrect;
      const timeTakenMs = seconds * 1000;

      const difficultyMultiplier: Record<PuzzleDifficulty, number> = {
        'Beginner': 100,
        'Intermediate': 200,
        'Advanced': 400,
        'Master': 800
      };

      const speedBonus = Math.max(0, Math.floor((60 - seconds) * 1.5));
      const scoreGained = isCorrect ? (difficultyMultiplier[currentPuzzle.difficulty] + speedBonus) : 0;

      const newStreak = isCorrect ? stats.streak + 1 : 0;
      const newTotalAnswered = stats.totalAnswered + 1;
      const newTotalCorrect = isCorrect ? stats.totalCorrect + 1 : stats.totalCorrect;
      const newAccuracy = Math.round((newTotalCorrect / newTotalAnswered) * 100);
      const newAverageTimeMs = Math.round(((stats.averageTimeMs * stats.totalAnswered) + timeTakenMs) / newTotalAnswered);

      const historyItem = {
        timestamp: Date.now(),
        correct: isCorrect,
        timeMs: timeTakenMs,
        dimension: currentPuzzle.dimension,
        difficulty: currentPuzzle.difficulty,
        scoreGained
      };

      const newStats: TrainingStats = {
        score: stats.score + scoreGained,
        streak: newStreak,
        accuracy: newAccuracy,
        totalAnswered: newTotalAnswered,
        totalCorrect: newTotalCorrect,
        averageTimeMs: newAverageTimeMs,
        history: [historyItem, ...stats.history]
      };

      onUpdateStats(newStats);
    } else {
      if (selectedCtxAnswerIdx === null || isSubmitted || !currentCtxPuzzle) return;

      setIsSubmitted(true);
      const selectedOption = currentCtxPuzzle.options[selectedCtxAnswerIdx];
      const isCorrect = selectedOption.isCorrect;
      const timeTakenMs = seconds * 1000;

      const difficultyMultiplier: Record<PuzzleDifficulty, number> = {
        'Beginner': 120,
        'Intermediate': 240,
        'Advanced': 480,
        'Master': 960
      };

      const speedBonus = Math.max(0, Math.floor((90 - seconds) * 1.5));
      const scoreGained = isCorrect ? (difficultyMultiplier[currentCtxPuzzle.difficulty] + speedBonus) : 0;

      const newStreak = isCorrect ? stats.streak + 1 : 0;
      const newTotalAnswered = stats.totalAnswered + 1;
      const newTotalCorrect = isCorrect ? stats.totalCorrect + 1 : stats.totalCorrect;
      const newAccuracy = Math.round((newTotalCorrect / newTotalAnswered) * 100);
      const newAverageTimeMs = Math.round(((stats.averageTimeMs * stats.totalAnswered) + timeTakenMs) / newTotalAnswered);

      const historyItem = {
        timestamp: Date.now(),
        correct: isCorrect,
        timeMs: timeTakenMs,
        dimension: currentCtxPuzzle.dimension,
        difficulty: currentCtxPuzzle.difficulty,
        scoreGained
      };

      const newStats: TrainingStats = {
        score: stats.score + scoreGained,
        streak: newStreak,
        accuracy: newAccuracy,
        totalAnswered: newTotalAnswered,
        totalCorrect: newTotalCorrect,
        averageTimeMs: newAverageTimeMs,
        history: [historyItem, ...stats.history]
      };

      onUpdateStats(newStats);
    }
  };

  const handleNextPuzzle = () => {
    handleStartTraining();
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-6" id="training-workspace-container">
      
      {/* Workout mode sub-toggle */}
      <div className="flex bg-theme-bg p-1 border border-theme-comp/40 select-none">
        <button
          onClick={() => setWorkoutMode('classic')}
          className={`flex-1 py-1.5 text-xs font-sans font-bold flex items-center justify-center gap-2 uppercase tracking-wide cursor-pointer rounded-none transition-all duration-150 ${
            workoutMode === 'classic'
              ? 'bg-theme-comp text-theme-bg'
              : 'text-theme-text hover:bg-theme-comp/10'
          }`}
        >
          <Brain className="w-4 h-4" />
          Classic Deductions
        </button>
        <button
          onClick={() => setWorkoutMode('context')}
          className={`flex-1 py-1.5 text-theme-text text-xs font-sans font-bold flex items-center justify-center gap-2 uppercase tracking-wide cursor-pointer rounded-none transition-all duration-150 ${
            workoutMode === 'context'
              ? 'bg-theme-comp text-theme-bg'
              : 'text-theme-text hover:bg-theme-comp/10'
          }`}
        >
          <Compass className="w-4 h-4" />
          Context
        </button>
      </div>

      {/* Configuration row */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-theme-card border border-theme-comp p-4 shadow-sm">
        {/* Dim toggle */}
        <div className="md:col-span-4 flex flex-col gap-2">
          <label className="text-xs font-mono text-theme-text font-bold tracking-wider">DIMENSIONAL SPACE</label>
          <div className="grid grid-cols-3 gap-1 bg-theme-bg p-1 border border-theme-comp/30">
            {([2, 3, 4] as DimensionCount[]).map(dim => (
              <button
                key={dim}
                id={`dim-toggle-${dim}`}
                onClick={() => setSelectedDim(dim)}
                className={`py-1.5 text-xs font-mono font-bold transition-all duration-150 rounded-none cursor-pointer ${
                  selectedDim === dim
                    ? 'bg-theme-comp text-theme-bg'
                    : 'text-theme-text hover:bg-theme-comp/10'
                }`}
              >
                {dim}D SPACE
              </button>
            ))}
          </div>
        </div>

        {/* Difficulty */}
        <div className="md:col-span-5 flex flex-col gap-2">
          <label className="text-xs font-mono text-theme-text font-bold tracking-wider">COGNITIVE LEVEL</label>
          <div className="grid grid-cols-4 gap-1 bg-theme-bg p-1 border border-theme-comp/30">
            {(['Beginner', 'Intermediate', 'Advanced', 'Master'] as PuzzleDifficulty[]).map(diff => (
              <button
                key={diff}
                id={`diff-level-${diff}`}
                onClick={() => setDifficulty(diff)}
                className={`py-1.5 text-[10px] font-mono font-bold transition-all duration-150 uppercase tracking-tight rounded-none cursor-pointer ${
                  difficulty === diff
                    ? 'bg-theme-comp text-theme-bg'
                    : 'text-theme-text hover:bg-theme-comp/10'
                }`}
              >
                {diff}
              </button>
            ))}
          </div>
        </div>

        {/* Start Button */}
        <div className="md:col-span-3 flex items-end">
          <button
            id="start-training-btn"
            onClick={handleStartTraining}
            className="w-full bg-theme-comp hover:bg-theme-comp/90 text-theme-bg text-xs font-sans font-bold py-3 px-4 border border-theme-comp flex items-center justify-center gap-2 transition-all cursor-pointer uppercase tracking-wider h-[40px]"
          >
            {isPlaying ? (
              <>
                <RotateCw className="w-3.5 h-3.5 animate-spin-slow" />
                Regenerate Map
              </>
            ) : (
              <>
                <Brain className="w-4 h-4" />
                Start Workout
              </>
            )}
          </button>
        </div>
      </div>

      {/* Decoupled Custom parameters Panel for both modes */}
      <div className="flex flex-col gap-3 bg-theme-bg/60 border border-theme-comp p-4 select-none -mt-2 animate-fadeIn" id="generator-settings-panel">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-theme-comp/20 pb-2.5">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-theme-comp" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-theme-text">
              {workoutMode === 'classic' ? 'Deduction Strategy Option' : 'Generator Strategy Option'}
            </span>
          </div>
          
          {/* Toggles between Presets and Custom Mode */}
          <div className="flex bg-theme-card border border-theme-comp/50 p-0.5" id="preset-custom-toggle-wrap">
            <button
               id="preset-mode-toggle"
              onClick={() => setGeneratorMode('preset')}
              className={`px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-wide transition-all duration-150 rounded-none cursor-pointer ${
                generatorMode === 'preset'
                  ? 'bg-theme-comp text-theme-bg'
                  : 'text-theme-text hover:bg-theme-comp/10'
              }`}
            >
              Level Presets
            </button>
            <button
              id="custom-mode-toggle"
              onClick={() => setGeneratorMode('custom')}
              className={`px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-wide transition-all duration-150 rounded-none cursor-pointer ${
                generatorMode === 'custom'
                  ? 'bg-theme-comp text-theme-bg'
                  : 'text-theme-text hover:bg-theme-comp/10'
              }`}
            >
              Custom Parameters
            </button>
          </div>
        </div>

        {/* Render parameters only if useCustom is enabled */}
        {generatorMode === 'custom' ? (
          <div className="flex flex-col gap-4 animate-slideDown" id="custom-parameters-content">
            {workoutMode === 'classic' ? (
              // Classic mode custom options
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Number of Premises / Relations */}
                <div className="flex flex-col gap-1.5" id="classic-premises-count-control">
                  <span className="text-[10px] font-mono text-theme-text/75 font-bold uppercase">Premises (Relations)</span>
                  <div className="flex items-center gap-2 bg-theme-card p-1.5 border border-theme-comp/40 h-[34px]">
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={customAnchors}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(12, parseInt(e.target.value) || 1));
                        setCustomAnchors(val);
                      }}
                      className="w-full bg-transparent text-xs font-mono font-bold text-theme-text focus:outline-none px-1 border-none"
                    />
                    <span className="text-[9px] font-mono font-bold text-theme-text/50 pr-1 uppercase whitespace-nowrap">1-12 Max</span>
                  </div>
                </div>

                {/* Scramble / Shuffle settings */}
                <div className="flex flex-col gap-1.5" id="classic-scramble-control">
                  <span className="text-[10px] font-mono text-theme-text/75 font-bold uppercase">Premise Shuffle (Scramble)</span>
                  <div className="grid grid-cols-3 gap-0.5 bg-theme-card p-0.5 border border-theme-comp/40">
                    {(['none', 'partial', 'full'] as const).map(mode => (
                      <button
                        key={mode}
                        id={`btn-scramble-${mode}`}
                        onClick={() => setScrambleSetting(mode)}
                        className={`py-1 text-[9px] font-mono font-bold uppercase transition-all duration-150 cursor-pointer ${
                          scrambleSetting === mode
                            ? 'bg-theme-comp text-theme-bg'
                            : 'text-theme-text hover:bg-theme-comp/10'
                        }`}
                      >
                        {mode === 'none' ? 'None' : mode === 'partial' ? 'Partial' : 'Full Scramble'}
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            ) : (
              // Context mode custom options (fully comprehensive)
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  
                  {/* Anchor Count Parameter */}
                  <div className="flex flex-col gap-1.5" id="context-anchors-control">
                    <span className="text-[10px] font-mono text-theme-text/75 font-bold uppercase">Relative Anchors</span>
                    <div className="flex items-center gap-2 bg-theme-card p-1.5 border border-theme-comp/40 h-[34px]">
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={customAnchors}
                        onChange={(e) => {
                          const val = Math.max(1, Math.min(12, parseInt(e.target.value) || 1));
                          setCustomAnchors(val);
                        }}
                        className="w-full bg-transparent text-xs font-mono font-bold text-theme-text focus:outline-none px-1 border-none"
                      />
                      <span className="text-[9px] font-mono font-bold text-theme-text/50 pr-1 uppercase whitespace-nowrap">1-12 Max</span>
                    </div>
                  </div>

                  {/* Shift Registers Depth Count */}
                  <div className="flex flex-col gap-1.5" id="context-pipeline-depth-control">
                    <span className="text-[10px] font-mono text-theme-text/75 font-bold uppercase">Shift Pipeline Depth</span>
                    <div className="flex items-center gap-2 bg-theme-card p-1.5 border border-theme-comp/40 h-[34px]">
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={customShiftsCount}
                        onChange={(e) => {
                          const val = Math.max(0, Math.min(10, parseInt(e.target.value) || 0));
                          setCustomShiftsCount(val);
                        }}
                        className="w-full bg-transparent text-xs font-mono font-bold text-theme-text focus:outline-none px-1 border-none"
                      />
                      <span className="text-[9px] font-mono font-bold text-theme-text/50 pr-1 uppercase whitespace-nowrap">0-10 Ops</span>
                    </div>
                  </div>

                  {/* Cross-channel references option */}
                  <div className="flex flex-col gap-1.5" id="context-interrelation-control">
                    <span className="text-[10px] font-mono text-theme-text/75 font-bold uppercase">Register Interrelation</span>
                    <div className="grid grid-cols-2 gap-0.5 bg-theme-card p-0.5 border border-theme-comp/40 h-[34px]">
                      <button
                        id="btn-interrelation-chain"
                        onClick={() => setCustomInterrelation('chain')}
                        className={`py-1 text-[9px] font-mono font-bold uppercase transition-all duration-150 cursor-pointer ${
                          customInterrelation === 'chain'
                            ? 'bg-theme-comp text-theme-bg'
                            : 'text-theme-text hover:bg-theme-comp/10'
                        }`}
                      >
                        Direct Chained
                      </button>
                      <button
                        id="btn-interrelation-cross"
                        disabled={customAnchors < 2 || customShiftsCount < 1}
                        onClick={() => setCustomInterrelation('cross')}
                        className={`py-1 text-[9px] font-mono font-bold uppercase transition-all duration-150 cursor-pointer ${
                          (customAnchors < 2 || customShiftsCount < 1)
                            ? 'opacity-25 cursor-not-allowed bg-theme-bg/50 text-neutral-400'
                            : customInterrelation === 'cross'
                              ? 'bg-theme-comp text-theme-bg'
                              : 'text-theme-text hover:bg-theme-comp/10'
                        }`}
                      >
                        Cross Registers
                      </button>
                    </div>
                  </div>

                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 border-t border-theme-comp/10 pt-3">
                  
                  {/* Contexts in Resolution */}
                  <div className="flex flex-col gap-1.5" id="context-resolution-count-control">
                    <span className="text-[10px] font-mono text-theme-text/75 font-bold uppercase">Contexts in Resolution</span>
                    <div className="grid grid-cols-5 gap-0.5 bg-theme-bg p-0.5 border border-theme-comp/40">
                      {/* We dynamically support the exact custom level options */}
                      {(['random', 'eq1', 'lte2', 'lte3', 'lte4'] as const).map(option => {
                        const totalPotentialShifts = customAnchors * customShiftsCount;
                        let disabled = false;
                        
                        if (option === 'eq1' && totalPotentialShifts < 1) disabled = true;
                        if (option === 'lte2' && totalPotentialShifts < 2) disabled = true;
                        if (option === 'lte3' && totalPotentialShifts < 3) disabled = true;
                        if (option === 'lte4' && totalPotentialShifts < 4) disabled = true;

                        let label = 'Random';
                        if (option === 'eq1') label = '= 1 (L1)';
                        if (option === 'lte2') label = '≤ 2 (L2)';
                        if (option === 'lte3') label = '≤ 3 (L3)';
                        if (option === 'lte4') label = '≤ 4 (L4)';

                        return (
                          <button
                            key={option}
                            id={`btn-activecount-${option}`}
                            disabled={disabled}
                            onClick={() => setCustomActiveCount(option)}
                            className={`py-1 text-[8px] font-mono font-bold uppercase transition-all duration-150 cursor-pointer leading-tight ${
                              disabled 
                                ? 'opacity-25 cursor-not-allowed bg-theme-bg/50 text-neutral-400' 
                                : customActiveCount === option
                                  ? 'bg-theme-comp text-theme-bg'
                                  : 'text-theme-text hover:bg-theme-comp/10'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Scramble Setting / Premise Shuffle */}
                  <div className="flex flex-col gap-1.5" id="context-scramble-control">
                    <span className="text-[10px] font-mono text-theme-text/75 font-bold uppercase">Premise Shuffle (Scramble)</span>
                    <div className="grid grid-cols-3 gap-0.5 bg-theme-bg p-0.5 border border-theme-comp/40">
                      {(['none', 'partial', 'full'] as const).map(mode => (
                        <button
                          key={mode}
                          id={`btn-ctxscramble-${mode}`}
                          onClick={() => setScrambleSetting(mode)}
                          className={`py-1 text-[9px] font-mono font-bold uppercase transition-all duration-150 cursor-pointer ${
                            scrambleSetting === mode
                              ? 'bg-theme-comp text-theme-bg'
                              : 'text-theme-text hover:bg-theme-comp/10'
                          }`}
                        >
                          {mode === 'none' ? 'None' : mode === 'partial' ? 'Partial' : 'Full Scramble'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Context Generator Source / Implicit Inferences */}
                  <div className="flex flex-col gap-1.5" id="context-source-control">
                    <span className="text-[10px] font-mono text-theme-text/75 font-bold uppercase">Context Source</span>
                    <div className="grid grid-cols-3 gap-0.5 bg-theme-bg p-0.5 border border-theme-comp/40">
                      {(['premises', 'inferences', 'both'] as const).map(source => (
                        <button
                          key={source}
                          id={`btn-source-${source}`}
                          onClick={() => setContextType(source)}
                          className={`py-1 text-[9px] font-mono font-bold uppercase transition-all duration-150 cursor-pointer ${
                            contextType === source
                              ? 'bg-theme-comp text-theme-bg'
                              : 'text-theme-text hover:bg-theme-comp/10'
                          }`}
                        >
                          {source === 'premises' ? 'Premises' : source === 'inferences' ? 'Inferences' : 'Both (Mixed)'}
                        </button>
                      ))}
                    </div>
                  </div>

                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[10px] font-sans leading-relaxed p-2 border border-theme-comp" id="preset-mode-active-text" style={{ backgroundColor: 'var(--main-color)', color: 'var(--text-color)', borderColor: 'var(--main-color-complementary)' }}>
            Applying standard preset templates (
            <span className="font-mono font-bold" style={{ color: 'var(--text-color-accent)' }}>{difficulty.toUpperCase()}</span>). Toggle to the custom panel to fully decouple features, setup multiple concurrent relative vectors/premises, and configure custom scramble states or deep shift pipelines.
          </p>
        )}
      </div>

      {/* Main puzzle board */}
      {!isPlaying ? (
        <div className="flex flex-col items-center justify-center border border-theme-comp p-12 text-center bg-theme-card relative overflow-hidden h-[400px]">
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(var(--main-color-complementary) 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
               <Brain className="w-16 h-16 text-theme-comp/75 stroke-[1.2] mb-4" />
          <h3 className="font-serif italic text-xl text-theme-text mb-2 uppercase tracking-wide">
            {workoutMode === 'classic' ? 'Classic Vector Deduction System' : 'Mutational Context Space Initiator'}
          </h3>
          <p className="font-sans text-theme-text max-w-md text-xs leading-relaxed mb-6 opacity-80">
            {workoutMode === 'classic' 
              ? 'Deconstruct multi-dimensional coordinate displacement graphs. Use spatial deduction matrices to solve absolute coordinates of query nodes relative to target benchmarks.'
              : 'Evaluate absolute vector definitions under active linear context shifts. Compile and modify axis directions to predict mutated coordinate vectors across hyperspatial maps.'
            }
          </p>
          <button
            id="lobby-start-btn"
            onClick={handleStartTraining}
            className="bg-theme-comp hover:bg-theme-comp/90 text-theme-bg font-bold font-sans text-xs px-6 py-3 border border-theme-comp uppercase tracking-wider cursor-pointer transition-transform duration-100"
          >
            Initialize Relational Matrix
          </button>
        </div>
      ) : workoutMode === 'classic' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          
          {/* Left panel - Premise list */}
          <div className="lg:col-span-7 flex flex-col gap-4 bg-theme-card border border-theme-comp p-6 shadow-sm relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{ backgroundImage: 'radial-gradient(var(--main-color-complementary) 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
            
            <div className="flex justify-between items-center border-b border-theme-comp/30 pb-3 mb-2 z-10">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase font-bold text-theme-text">
                <ShieldCheck className="w-3.5 h-3.5 text-theme-comp" />
                <span>Riddle Engine ({currentPuzzle?.difficulty})</span>
              </div>
              <div className="flex items-center gap-1 bg-theme-bg border border-theme-comp/30 py-1 px-2.5">
                <Clock className="w-3.5 h-3.5 text-theme-comp" />
                <span className="font-mono text-xs font-bold text-theme-text">{formatTime(seconds)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 z-10">
              <p className="text-xs font-mono text-theme-text font-bold uppercase tracking-wide">Premises Declarations:</p>
              <div className="flex flex-col gap-1.5">
                {currentPuzzle?.premises.map((p, idx) => {
                  const puzzleBasis = currentPuzzle ? getBasisRelations(currentPuzzle.dimension) : {};
                  const relVector = puzzleBasis[p.relation] || [];
                  return (
                    <div
                      key={idx}
                      onMouseEnter={() => setHighlightedPremiseId(`pzp-${idx}`)}
                      onMouseLeave={() => setHighlightedPremiseId(null)}
                      className="flex flex-wrap items-center justify-between bg-theme-bg border border-theme-comp/40 hover:border-theme-comp px-4 py-2 text-xs font-sans transition-all duration-150 cursor-help"
                    >
                      <span className="flex items-center gap-2 flex-wrap text-theme-text">
                        <span className="w-1.5 h-1.5 bg-theme-comp rotate-45"></span>
                        <strong className="text-theme-text font-mono">{p.entityA}</strong>
                        <span className="text-theme-text/80 font-serif italic">is</span>
                        <span className="font-mono font-bold px-1.5 py-0.5" style={{ backgroundColor: 'var(--main-color-complementary)', color: 'var(--main-color)' }}>{p.relation}</span>
                        <span className="text-theme-text/80 font-serif italic">of</span>
                        <strong className="text-theme-text font-mono">{p.entityB}</strong>
                      </span>
                      <span className="text-[9px] font-mono text-theme-text/50 bg-theme-bg px-2 py-0.5 border border-dashed border-theme-comp/20 mt-1 sm:mt-0 font-bold">Premise #{idx + 1}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-theme-bg border border-theme-comp p-4 my-2 z-10">
              <div className="flex gap-2.5 items-start">
                <HelpCircle className="w-5 h-5 shrink-0 mt-0.5 text-theme-comp" />
                <div className="flex flex-col">
                  <p className="text-xs font-mono font-bold text-theme-text uppercase tracking-wide">Deduce Vector Displacement</p>
                  <p className="text-sm font-sans font-bold text-theme-text leading-relaxed mt-1">
                    Determine the coordinates position of <strong className="font-mono px-1 ml-1" style={{ backgroundColor: 'var(--main-color-complementary)', color: 'var(--main-color)' }}>{currentPuzzle?.question.entityA}</strong> with respect to <strong className="font-mono border border-theme-comp/40 px-1 ml-1 bg-theme-card">{currentPuzzle?.question.entityB}</strong>.
                  </p>
                </div>
              </div>
            </div>

          </div>
 
          {/* Multiple Choice Answers column */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="bg-theme-card border border-theme-comp p-5 shadow-sm flex flex-col flex-1">
              <span className="text-xs font-mono text-theme-text font-bold uppercase tracking-wider mb-3">SELECT RESPONSE CARD</span>
              
              <div className="flex flex-col gap-2.5 flex-1 justify-center">
                {currentPuzzle?.options.map((opt, idx) => {
                  const isSelected = selectedAnswerIdx === idx;
                  let cardStyle = "border-theme-comp/30 bg-theme-bg/50 text-theme-text hover:bg-theme-comp/10";
                  
                  if (isSelected) {
                    cardStyle = "border-2 border-theme-comp bg-theme-comp text-theme-bg font-bold";
                  }

                  if (isSubmitted) {
                    if (opt.isCorrect) {
                      cardStyle = "border-2 border-green-600 bg-theme-bg text-green-500 font-bold shadow-sm";
                    } else if (isSelected) {
                      cardStyle = "border-2 border-red-500 bg-theme-bg text-red-500 line-through opacity-70";
                    } else {
                      cardStyle = "border-theme-comp/20 bg-theme-bg/20 opacity-40 cursor-not-allowed";
                    }
                  }

                  return (
                    <button
                      key={idx}
                      id={`mc-option-${idx}`}
                      onClick={() => handleSelectAnswer(idx)}
                      disabled={isSubmitted}
                      className={`w-full text-left p-3.5 border transition-all duration-150 cursor-pointer flex items-center justify-between rounded-none ${cardStyle}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-5 h-5 border text-[10px] font-mono flex items-center justify-center font-bold rounded-none ${
                          isSelected ? 'bg-theme-comp border-theme-comp text-theme-bg' : 'border-theme-comp text-theme-text/50'
                        }`}>
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span className="font-mono text-xs font-bold uppercase tracking-wide">{opt.relation}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 pt-4 border-t border-theme-comp">
                {!isSubmitted ? (
                  <button
                    id="submit-answer-btn"
                    onClick={handleSubmitAnswer}
                    disabled={selectedAnswerIdx === null}
                    className="w-full bg-theme-comp hover:bg-theme-comp/90 disabled:opacity-30 disabled:cursor-not-allowed text-theme-bg text-xs font-mono font-bold py-3 px-4 border border-theme-comp flex items-center justify-center gap-2 cursor-pointer transition-all duration-150 uppercase tracking-widest h-[44px]"
                  >
                    <span>Submit Relational Deductions</span>
                    <ArrowRight className="w-4 h-4 ml-0.5" />
                  </button>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="text-center py-1 text-xs font-sans font-bold uppercase tracking-wider">
                      {currentPuzzle?.options[selectedAnswerIdx ?? 0]?.isCorrect ? (
                        <span className="text-green-500 flex items-center justify-center gap-1.5 bg-theme-bg border border-green-600 py-2 font-bold font-mono">
                          <Trophy className="w-4 h-4" /> SUCCESS • +{100 + Math.max(0, Math.floor((60 - seconds) * 1.5))} SCORE ACCUMULATED
                        </span>
                      ) : (
                        <span className="text-red-500 flex items-center justify-center gap-1.5 bg-theme-bg border border-red-500 py-2 font-bold font-mono">
                          DEDUCTION ENCOUNTERED COGNITIVE DIVERGENCE
                        </span>
                      )}
                    </div>
                    <button
                      id="next-puzzle-btn"
                      onClick={handleNextPuzzle}
                      className="w-full bg-theme-comp hover:bg-theme-comp/90 text-theme-bg text-xs font-sans font-bold py-3 px-4 border border-theme-comp flex items-center justify-center gap-2 cursor-pointer transition-all uppercase tracking-wide h-[44px]"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Request Next Vector Matrix</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        // PLAYGROUND: CONTEXT MUTATOR MODE (Relational Workout "Context")
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          
          <div className="lg:col-span-7 flex flex-col gap-4 bg-theme-card border border-theme-comp p-6 shadow-sm relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{ backgroundImage: 'radial-gradient(var(--main-color-complementary) 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
            
            <div className="flex justify-between items-center border-b border-theme-comp/30 pb-3 mb-2 z-10 select-none">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase font-bold text-theme-text">
                <ShieldCheck className="w-3.5 h-3.5 text-theme-comp" />
                <span>Context Multiplier Engine ({currentCtxPuzzle?.difficulty})</span>
              </div>
              <div className="flex items-center gap-1 bg-theme-bg border border-theme-comp/30 py-1 px-2.5">
                <Clock className="w-3.5 h-3.5 text-theme-comp" />
                <span className="font-mono text-xs font-bold text-theme-text">{formatTime(seconds)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 z-10 select-text">
              <p className="text-xs font-mono text-theme-text font-bold uppercase tracking-wide">Anchor Definitions:</p>
              <div className="flex flex-col gap-1.5 font-sans text-xs">
                {currentCtxPuzzle?.nodeDefinitions.map((def, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-theme-bg border border-theme-comp/40 px-4 py-2">
                    <span className="flex items-center gap-2 flex-wrap text-theme-text">
                      <span className="w-2 h-2 border border-theme-comp rotate-45"></span>
                      <strong className="text-theme-text font-mono">{def.node}</strong>
                      <span className="opacity-80 font-serif italic">is initially positioned</span>
                      <span className="font-mono font-bold px-1.5 py-0.5" style={{ backgroundColor: 'var(--main-color-complementary)', color: 'var(--main-color)' }}>{def.relation}</span>
                      <span className="opacity-80 font-serif italic">of</span>
                      <strong className="text-theme-text font-mono">{def.targetNode}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 z-10 mt-1 select-text">
              <p className="text-xs font-mono text-theme-text font-bold uppercase tracking-wide">Context Window Switches (Active Stack):</p>
              <div className="flex flex-col gap-1.5 font-sans">
                {currentCtxPuzzle?.contextVehicles.map((ctx, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-theme-bg border border-theme-comp/30 px-4 py-2 text-xs">
                    <span className="flex items-center gap-2 flex-wrap font-mono font-bold text-theme-text">
                      <Sliders className="w-3.5 h-3.5 text-theme-comp" />
                      <span>{ctx.text}</span>
                    </span>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 border uppercase ${
                      ctx.isAnchor
                        ? 'bg-theme-bg border-theme-comp/30 text-theme-text'
                        : ctx.shiftMultiplier < 0 
                          ? 'bg-theme-comp/10 border-theme-comp/50 text-theme-accent' 
                          : 'bg-theme-comp/20 border-theme-comp text-theme-accent'
                    }`}>
                      {ctx.isAnchor ? 'Relative Vector' : ctx.shiftMultiplier < 0 ? 'Inversion' : 'Scale'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-theme-bg border border-theme-comp p-4 my-2 z-10 select-text font-sans">
              <div className="flex gap-2.5 items-start">
                <HelpCircle className="w-5 h-5 shrink-0 mt-0.5 text-theme-comp" />
                <div className="flex flex-col flex-1">
                  <p className="text-xs font-mono font-bold text-theme-text uppercase tracking-wide opacity-60">Hyperspatial Resolution Inquiry</p>
                  <p className="text-theme-text font-bold leading-relaxed mt-1 text-sm md:text-base">
                    What is <strong className="font-mono px-1.5 py-0.5" style={{ backgroundColor: 'var(--main-color-complementary)', color: 'var(--main-color)' }}>{currentCtxPuzzle?.queryNode}::{currentCtxPuzzle?.queryTarget}</strong> in context <strong className="font-mono border border-theme-comp px-1.5 py-0.5 bg-theme-card font-extrabold text-theme-accent">[{currentCtxPuzzle?.activeContextGroup.join('')}]</strong>?
                  </p>
                  
                  <div className="mt-3.5 flex items-center justify-between border-t border-dashed border-theme-comp/20 pt-3 flex-wrap gap-2">
                    <span className="text-[10px] sm:text-[11px] font-mono text-theme-text/60 font-medium">Need help spatializing the transformations?</span>
                    <button
                      onClick={() => setShowCtxExplanation(prev => !prev)}
                      className="px-3 py-1 bg-theme-card hover:bg-theme-comp/10 text-theme-text text-[10px] sm:text-[11px] font-mono font-bold border border-theme-comp flex items-center gap-1.5 cursor-pointer uppercase tracking-tight select-none transition-all duration-150"
                    >
                      <Brain className="w-3.5 h-3.5" />
                      {showCtxExplanation ? 'Hide Derivation' : 'Explain Process'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Explanation Display Block */}
            {showCtxExplanation && currentCtxPuzzle && (
              <div className="bg-theme-bg border border-theme-comp p-4 mb-3 text-xs font-mono z-10 select-text animate-fadeIn">
                <div className="flex items-center gap-1.5 text-theme-text font-bold border-b border-theme-comp pb-2 mb-2.5 uppercase tracking-wide text-[10px]">
                  <Activity className="w-4 h-4 text-theme-comp animate-pulse" />
                  <span>Hyperspatial Logic Resolution Log</span>
                </div>
                <div className="space-y-3.5 text-theme-text leading-relaxed text-[11px]">
                  <div>
                    <span className="font-bold border-b border-theme-comp/30 pb-0.5">1. Baseline Coordinate Difference:</span> <br />
                    - The initial spatial offset <strong className="font-bold">{currentCtxPuzzle.queryNode}::{currentCtxPuzzle.queryTarget}</strong> matches relation: <br />
                    <code className="bg-theme-card px-2 py-0.5 font-bold border border-theme-comp/25 inline-block mt-1 font-mono">
                      [{currentCtxPuzzle.baseOffsetVector.slice(0, selectedDim).join(', ')}] ({currentCtxPuzzle.baseRelation})
                    </code>
                  </div>
                  
                  <div>
                    <span className="font-bold border-b border-theme-comp/30 pb-0.5">2. Compiling Modifiers Stack:</span> <br />
                    {currentCtxPuzzle.contextVehicles.map((cv, id) => {
                      const isActive = currentCtxPuzzle.activeContextGroup.includes(cv.id);
                      const repVec = cv.representedVector || Array(selectedDim).fill(0);
                      const relationName = describeContextVector(repVec, selectedDim);
                      return (
                        <span key={id} className="block pl-3 mt-1.5 border-l border-dashed border-theme-comp/30">
                          • <strong className="text-[11px]">{cv.text}</strong> &rarr; <span className={isActive ? "font-bold select-all bg-theme-comp/10 border border-theme-comp text-theme-accent px-1" : "opacity-45"}>
                            {isActive ? 'ACTIVE IN STACK' : 'BYPASSED'}
                          </span>
                          {isActive && (
                            <span className="block text-[10px] pl-2 mt-0.5 text-theme-text/85">
                              This applies {cv.isAnchor ? 'the anchor relation' : cv.shiftMultiplier < 0 ? 'an Inversion (-1 coeff)' : `a Scaling of x${cv.shiftMultiplier}`} resulting in representation: <br />
                              <strong className="font-sans font-bold text-xs select-all text-theme-accent">
                                {relationName} [{repVec.slice(0, selectedDim).join(', ')}]
                              </strong>
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                  
                  <div className="border-t border-dashed border-theme-comp/20 pt-2.5">
                    <span className="font-bold border-b border-theme-comp/30 pb-0.5 text-[10.5px]">3. Compounding Result:</span> <br />
                    - Applying the active coordinate axis shifts to the base vector scales/inverts corresponding dimensions to yield the transformed vector: <br />
                    <code className="px-2 py-1 inline-block mt-2 font-bold text-xs" style={{ backgroundColor: 'var(--main-color-complementary)', color: 'var(--main-color)' }}>
                      [{currentCtxPuzzle.projectedVector.slice(0, selectedDim).join(', ')}] ({currentCtxPuzzle.projectedRelation})
                    </code>
                  </div>
                </div>
              </div>
            )}


          </div>

          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="bg-theme-card border border-theme-comp p-5 shadow-sm flex flex-col flex-1">
              <span className="text-xs font-mono text-theme-text font-bold uppercase tracking-wider mb-3">SELECT RESPONSE CARD</span>
              
              <div className="flex flex-col gap-2.5 flex-1 justify-center select-none">
                {currentCtxPuzzle?.options.map((opt, idx) => {
                  const isSelected = selectedCtxAnswerIdx === idx;
                  let cardStyle = "border-theme-comp/30 bg-theme-bg/50 text-theme-text hover:bg-theme-comp/10";
                  
                  if (isSelected) {
                    cardStyle = "border-2 border-theme-comp bg-theme-comp text-theme-bg font-bold";
                  }

                  if (isSubmitted) {
                    if (opt.isCorrect) {
                      cardStyle = "border-2 border-green-600 bg-theme-bg text-green-500 font-bold shadow-sm";
                    } else if (isSelected) {
                      cardStyle = "border-2 border-red-500 bg-theme-bg text-red-500 line-through opacity-70";
                    } else {
                      cardStyle = "border-theme-comp/20 bg-theme-bg/20 opacity-40 cursor-not-allowed";
                    }
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelectAnswer(idx)}
                      disabled={isSubmitted}
                      className={`w-full text-left p-3.5 border transition-all duration-150 cursor-pointer flex items-center justify-between rounded-none ${cardStyle}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-5 h-5 border text-[10px] font-mono flex items-center justify-center font-bold rounded-none ${
                          isSelected ? 'bg-theme-comp border-theme-comp text-theme-bg' : 'border-theme-comp text-theme-text/50'
                        }`}>
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span className="font-mono text-xs font-bold uppercase tracking-wide">{opt.text}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 pt-4 border-t border-theme-comp select-none">
                {!isSubmitted ? (
                  <button
                    onClick={handleSubmitAnswer}
                    disabled={selectedCtxAnswerIdx === null}
                    className="w-full bg-theme-comp hover:bg-theme-comp/90 disabled:opacity-30 disabled:cursor-not-allowed text-theme-bg text-xs font-mono font-bold py-3 px-4 border border-theme-comp flex items-center justify-center gap-2 cursor-pointer transition-all duration-150 uppercase tracking-widest h-[44px]"
                  >
                    <span>Submit Projections deductions</span>
                    <ArrowRight className="w-4 h-4 ml-0.5" />
                  </button>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="text-center py-1 text-xs font-sans font-bold uppercase tracking-wider">
                      {currentCtxPuzzle?.options[selectedCtxAnswerIdx ?? 0]?.isCorrect ? (
                        <span className="text-green-500 flex items-center justify-center gap-1.5 bg-theme-bg border border-green-600 py-2 font-bold font-mono">
                          <Trophy className="w-4 h-4" /> SUCCESS • +{120 + Math.max(0, Math.floor((90 - seconds) * 1.5))} SCORE GAINED
                        </span>
                      ) : (
                        <span className="text-red-500 flex items-center justify-center gap-1.5 bg-theme-bg border border-red-500 py-2 font-bold font-mono">
                          PROJECTION DEVIAVATION DETECTED BY MATRIX
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleNextPuzzle}
                      className="w-full bg-theme-comp hover:bg-theme-comp/90 text-theme-bg text-xs font-sans font-bold py-3 px-4 border border-theme-comp flex items-center justify-center gap-2 cursor-pointer transition-all uppercase tracking-wide h-[44px]"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Request Next Coordinate Domain</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
