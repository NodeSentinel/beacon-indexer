'use client';

import { useState } from 'react';

import NodeCard from './node-card';
import NodeDialog from './node-dialog';

import { Badge } from '@/components/ui/badge';
import type { Node, NodeFilter } from '@/types/validator';

interface NodeListProps {
  nodes: Node[];
  selectedFilter?: NodeFilter;
}

function getAggregatedNode(nodes: Node[]): Node {
  if (!nodes || nodes.length === 0) {
    return {
      id: 'all',
      name: 'All Groups',
      withdrawalAddresses: [],
      feeRecipientAddress: '-',
      validatorIndices: [],
      validators: [],
      totalBalance: 0,
      totalEffectiveBalance: 0,
      claimableRewards: 0,
      performance: 0,
    };
  }

  const _totalValidators = nodes.reduce((sum, node) => sum + node.validators.length, 0);
  const allValidators = nodes.flatMap((node) => node.validators);
  const totalBalance = nodes.reduce((sum, node) => sum + node.totalBalance, 0);
  const totalEffectiveBalance = nodes.reduce((sum, node) => sum + node.totalEffectiveBalance, 0);
  const totalClaimable = nodes.reduce((sum, node) => sum + node.claimableRewards, 0);
  const avgPerformance = nodes.reduce((sum, node) => sum + node.performance, 0) / nodes.length;

  return {
    id: 'all',
    name: 'All Groups',
    withdrawalAddresses: [],
    feeRecipientAddress: '-',
    validatorIndices: [],
    validators: allValidators,
    totalBalance,
    totalEffectiveBalance,
    claimableRewards: totalClaimable,
    performance: avgPerformance,
  };
}

export default function NodeList({ nodes, selectedFilter = 'all' }: NodeListProps) {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleNodeClick = (node: Node) => {
    setSelectedNode(node);
    setIsDialogOpen(true);
  };

  const displayNode =
    selectedFilter === 'all'
      ? getAggregatedNode(nodes)
      : nodes?.find((n) => n.id === selectedFilter) || (nodes && nodes[0]) || getAggregatedNode([]);

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-display">
          {selectedFilter === 'all' ? 'ALL GROUPS' : displayNode.name.toUpperCase()}
        </h2>
        <Badge variant="secondary">{displayNode.validators.length} validators</Badge>
      </div>

      <NodeCard node={displayNode} onClick={() => handleNodeClick(displayNode)} />

      <NodeDialog node={selectedNode} open={isDialogOpen} onOpenChange={setIsDialogOpen} />
    </>
  );
}
