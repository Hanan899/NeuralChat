import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

import { useNeuralAnimation } from "../hooks/useNeuralAnimation";

const NODE_RADIUS = 10;
const ACTIVE_COLOR = "color-mix(in srgb, var(--accent-primary) 70%, white)";
const OUTER_NODE_COLOR = "color-mix(in srgb, var(--text-primary) 34%, var(--accent-primary) 66%)";
const CORE_NODE_COLOR = "var(--accent-primary)";
const EDGE_COLOR = "color-mix(in srgb, var(--accent-primary) 26%, transparent)";
const EDGE_ACTIVE_COLOR = "color-mix(in srgb, var(--accent-primary) 82%, white)";

export function NeuralNetworkLogo() {
  const prefersReducedMotion = useReducedMotion();
  const {
    nodes,
    edges,
    hasBuilt,
    pulseCycle,
    pulseNodeIds,
    pulseEdgeIds,
    activeNodeIds,
    activeEdgeIds,
  } = useNeuralAnimation();

  const pulseEdges = useMemo(
    () => edges.filter((edge) => pulseEdgeIds.includes(edge.id)),
    [edges, pulseEdgeIds]
  );

  return (
    <div className="nc-neural-logo" aria-hidden="true">
      <span className="nc-neural-logo__orb nc-neural-logo__orb--outer" />
      <span className="nc-neural-logo__orb nc-neural-logo__orb--middle" />
      <span className="nc-neural-logo__orb nc-neural-logo__orb--inner" />
      <span className="nc-neural-logo__flare" />

      <svg className="nc-neural-logo__svg" viewBox="0 0 200 160" fill="none" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="nc-neural-shadow" x="0" y="0" width="200" height="160" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#7f77dd" floodOpacity="0.18" />
          </filter>
        </defs>

        <g filter="url(#nc-neural-shadow)" transform="translate(6 0)">
          {edges.map((edge) => {
            const isActive = activeEdgeIds.includes(edge.id);
            return (
              <motion.line
                key={edge.id}
                x1={edge.from.x}
                y1={edge.from.y}
                x2={edge.to.x}
                y2={edge.to.y}
                stroke={isActive ? EDGE_ACTIVE_COLOR : EDGE_COLOR}
                strokeWidth={isActive ? 3.2 : 2.1}
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0.08 }}
                animate={{
                  pathLength: 1,
                  opacity: isActive ? 1 : 1,
                }}
                transition={prefersReducedMotion ? { duration: 0.25 } : {
                  duration: 0.48,
                  delay: 0.88 + edge.order * 0.04,
                  ease: [0.2, 0.8, 0.2, 1],
                }}
              />
            );
          })}

          {nodes.map((node) => {
            const isCoreLayer = node.layerIndex === 1;
            const isActive = activeNodeIds.includes(node.id);
            const isPulsing = pulseNodeIds.includes(node.id) && hasBuilt;

            return (
              <motion.circle
                key={node.id}
                cx={node.x}
                cy={node.y}
                r={node.layerIndex === 1 ? NODE_RADIUS + 1.5 : NODE_RADIUS}
                fill={isActive ? ACTIVE_COLOR : isCoreLayer ? CORE_NODE_COLOR : OUTER_NODE_COLOR}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{
                  opacity: isActive ? 1 : isPulsing ? [0.74, 1, 0.82] : [0.76, 0.94, 0.76],
                  scale: isActive ? 1.18 : isPulsing ? [1, 1.08, 1] : [1, 1.04, 1],
                }}
                transition={prefersReducedMotion ? { duration: 0.2 } : {
                  delay: node.order * 0.14,
                  duration: 0.46,
                  ease: [0.16, 1, 0.3, 1],
                  repeat: hasBuilt ? Number.POSITIVE_INFINITY : 0,
                  repeatDelay: isPulsing ? 2.5 : 1.9,
                }}
                style={{ transformOrigin: `${node.x}px ${node.y}px` }}
              />
            );
          })}

          {!prefersReducedMotion && hasBuilt ? pulseEdges.map((edge, edgeIndex) => {
            const key = `${edge.id}-${pulseCycle}-${edgeIndex}`;
            return (
              <motion.circle
                key={key}
                r={4.6}
                fill={ACTIVE_COLOR}
                initial={{ cx: edge.from.x, cy: edge.from.y, opacity: 0, scale: 0.5 }}
                animate={{
                  cx: [edge.from.x, edge.to.x],
                  cy: [edge.from.y, edge.to.y],
                  opacity: [0, 1, 1, 0],
                  scale: [0.45, 1, 1, 0.55],
                }}
                transition={{
                  duration: 1.35,
                  ease: "easeInOut",
                  delay: edgeIndex * 0.24,
                }}
              />
            );
          }) : null}
        </g>
      </svg>
    </div>
  );
}
