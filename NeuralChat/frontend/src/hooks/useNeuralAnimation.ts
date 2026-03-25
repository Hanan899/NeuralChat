import { useEffect, useMemo, useState } from "react";

export type NeuralNode = {
  id: string;
  x: number;
  y: number;
  layerIndex: number;
  nodeIndex: number;
  order: number;
};

export type NeuralEdge = {
  id: string;
  from: NeuralNode;
  to: NeuralNode;
  order: number;
  phase: "input-hidden" | "hidden-output";
};

type SignalStage = "idle" | "inputs" | "inputEdges" | "hidden" | "outputEdges" | "outputs";

const LAYER_COORDINATES = [
  [
    { x: 30, y: 40 },
    { x: 30, y: 80 },
    { x: 30, y: 120 },
  ],
  [
    { x: 90, y: 20 },
    { x: 90, y: 60 },
    { x: 90, y: 100 },
    { x: 90, y: 140 },
  ],
  [
    { x: 160, y: 60 },
    { x: 160, y: 100 },
  ],
] as const;

function pickRandomIds(items: readonly { id: string }[], desiredCount: number): string[] {
  if (items.length === 0 || desiredCount <= 0) {
    return [];
  }

  const shuffledItems = [...items]
    .map((item) => ({ item, sortValue: Math.random() }))
    .sort((left, right) => left.sortValue - right.sortValue)
    .map((entry) => entry.item);

  return shuffledItems.slice(0, Math.min(desiredCount, shuffledItems.length)).map((item) => item.id);
}

export function useNeuralAnimation() {
  const { nodes, edges, inputNodeIds, hiddenNodeIds, outputNodeIds, inputEdgeIds, outputEdgeIds } = useMemo(() => {
    const computedNodes: NeuralNode[] = [];

    LAYER_COORDINATES.forEach((layerNodes, layerIndex) => {
      layerNodes.forEach((position, nodeIndex) => {
        computedNodes.push({
          id: `layer-${layerIndex}-node-${nodeIndex}`,
          x: position.x,
          y: position.y,
          layerIndex,
          nodeIndex,
          order: computedNodes.length,
        });
      });
    });

    const computedEdges: NeuralEdge[] = [];
    for (let layerIndex = 0; layerIndex < LAYER_COORDINATES.length - 1; layerIndex += 1) {
      const sourceNodes = computedNodes.filter((node) => node.layerIndex === layerIndex);
      const targetNodes = computedNodes.filter((node) => node.layerIndex === layerIndex + 1);
      sourceNodes.forEach((sourceNode) => {
        targetNodes.forEach((targetNode) => {
          computedEdges.push({
            id: `${sourceNode.id}__${targetNode.id}`,
            from: sourceNode,
            to: targetNode,
            order: computedEdges.length,
            phase: layerIndex === 0 ? "input-hidden" : "hidden-output",
          });
        });
      });
    }

    return {
      nodes: computedNodes,
      edges: computedEdges,
      inputNodeIds: computedNodes.filter((node) => node.layerIndex === 0).map((node) => node.id),
      hiddenNodeIds: computedNodes.filter((node) => node.layerIndex === 1).map((node) => node.id),
      outputNodeIds: computedNodes.filter((node) => node.layerIndex === 2).map((node) => node.id),
      inputEdgeIds: computedEdges.filter((edge) => edge.phase === "input-hidden").map((edge) => edge.id),
      outputEdgeIds: computedEdges.filter((edge) => edge.phase === "hidden-output").map((edge) => edge.id),
    };
  }, []);

  const [hasBuilt, setHasBuilt] = useState(false);
  const [signalStage, setSignalStage] = useState<SignalStage>("idle");
  const [pulseNodeIds, setPulseNodeIds] = useState<string[]>([]);
  const [pulseEdgeIds, setPulseEdgeIds] = useState<string[]>([]);
  const [pulseCycle, setPulseCycle] = useState(0);

  useEffect(() => {
    const buildTimer = window.setTimeout(() => {
      setHasBuilt(true);
    }, 2050);

    return () => {
      window.clearTimeout(buildTimer);
    };
  }, []);

  useEffect(() => {
    if (!hasBuilt) {
      return;
    }

    let cancelled = false;
    const timers: number[] = [];

    const runCycle = () => {
      if (cancelled) {
        return;
      }

      setPulseCycle((currentValue) => currentValue + 1);
      setPulseNodeIds(pickRandomIds(nodes, 3));
      setPulseEdgeIds(pickRandomIds(edges, 3));
      setSignalStage("inputs");

      timers.push(window.setTimeout(() => setSignalStage("inputEdges"), 440));
      timers.push(window.setTimeout(() => setSignalStage("hidden"), 980));
      timers.push(window.setTimeout(() => setSignalStage("outputEdges"), 1480));
      timers.push(window.setTimeout(() => setSignalStage("outputs"), 1980));
      timers.push(window.setTimeout(() => setSignalStage("idle"), 2720));
      timers.push(window.setTimeout(() => {
        setPulseNodeIds([]);
        setPulseEdgeIds([]);
      }, 2880));

      const nextDelay = 3600 + Math.round(Math.random() * 450);
      timers.push(window.setTimeout(runCycle, nextDelay));
    };

    timers.push(window.setTimeout(runCycle, 520));

    return () => {
      cancelled = true;
      timers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [edges, hasBuilt, nodes]);

  const activeNodeIds = useMemo(() => {
    if (signalStage === "inputs") {
      return inputNodeIds;
    }
    if (signalStage === "inputEdges" || signalStage === "hidden") {
      return hiddenNodeIds;
    }
    if (signalStage === "outputEdges" || signalStage === "outputs") {
      return outputNodeIds;
    }
    return [] as string[];
  }, [hiddenNodeIds, inputNodeIds, outputNodeIds, signalStage]);

  const activeEdgeIds = useMemo(() => {
    if (signalStage === "inputEdges" || signalStage === "hidden") {
      return inputEdgeIds;
    }
    if (signalStage === "outputEdges" || signalStage === "outputs") {
      return outputEdgeIds;
    }
    return [] as string[];
  }, [inputEdgeIds, outputEdgeIds, signalStage]);

  return {
    nodes,
    edges,
    hasBuilt,
    pulseCycle,
    pulseNodeIds,
    pulseEdgeIds,
    activeNodeIds,
    activeEdgeIds,
  };
}
