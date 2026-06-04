import { useState, useEffect } from 'react';
import { Box, Flex, Text, Button, ScrollArea, Tabs, Card } from '@radix-ui/themes';

interface TreeNode {
  title: string;
  title_en?: string;
  type?: string;
  level?: number;
  children?: TreeNode[];
  content?: string;
  line_number?: number;
  emoji?: string;
}

interface ComparisonStats {
  totalNodes: number;
  nodesWithContent: number;
  contentLength: number;
  maxDepth: number;
  avgChildrenPerNode: number;
}

export default function TestModuleCompare() {
  const [oldTree, setOldTree] = useState<TreeNode[] | null>(null);
  const [newTree, setNewTree] = useState<TreeNode[] | null>(null);
  const [oldStats, setOldStats] = useState<ComparisonStats | null>(null);
  const [newStats, setNewStats] = useState<ComparisonStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        
        // Load old tree
        const oldRes = await fetch('/test-data/chapter_tree_with_content_backup_v1.json');
        const oldData = await oldRes.json();
        setOldTree(oldData);
        setOldStats(calculateStats(oldData));

        // Load new tree
        const newRes = await fetch('/test-data/chapter_tree_with_content.json');
        const newData = await newRes.json();
        setNewTree(newData);
        setNewStats(calculateStats(newData));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const calculateStats = (tree: TreeNode[]): ComparisonStats => {
    let totalNodes = 0;
    let nodesWithContent = 0;
    let contentLength = 0;
    let maxDepth = 0;
    let totalChildren = 0;

    const traverse = (nodes: TreeNode[], depth: number = 0) => {
      maxDepth = Math.max(maxDepth, depth);
      totalNodes += nodes.length;

      nodes.forEach((node) => {
        if (node.content && node.content.trim()) {
          nodesWithContent++;
          contentLength += node.content.length;
        }
        if (node.children) {
          totalChildren += node.children.length;
          traverse(node.children, depth + 1);
        }
      });
    };

    traverse(tree);
    const avgChildrenPerNode = totalNodes > 0 ? (totalChildren / totalNodes).toFixed(2) : '0';

    return {
      totalNodes,
      nodesWithContent,
      contentLength,
      maxDepth,
      avgChildrenPerNode: parseFloat(avgChildrenPerNode as string),
    };
  };

  const TreeViewer = ({ tree, title }: { tree: TreeNode[] | null; title: string }) => {
    const renderNode = (node: TreeNode, depth: number = 0) => {
      const indent = depth * 20;
      const hasContent = node.content && node.content.trim();
      const contentPreview = hasContent ? node.content!.substring(0, 100).replace(/\n/g, ' ') : '';

      return (
        <Box key={`${node.title}-${depth}`} style={{ marginLeft: `${indent}px`, marginBottom: '8px' }}>
          <Box
            style={{
              padding: '8px',
              backgroundColor: hasContent ? '#f0f9ff' : '#f5f5f5',
              borderRadius: '4px',
              borderLeft: `3px solid ${hasContent ? '#3b82f6' : '#d1d5db'}`,
            }}
          >
            <Text size="2" weight="bold">
              {node.emoji || '📄'} {node.title}
            </Text>
            <Text size="1" color="gray">
              Level {node.level} | Type: {node.type || 'unknown'}
            </Text>
            {hasContent && (
              <Text size="1" style={{ marginTop: '4px', color: '#666' }}>
                📝 {contentPreview}...
              </Text>
            )}
          </Box>
          {node.children && node.children.length > 0 && (
            <Box style={{ marginTop: '4px' }}>
              {node.children.map((child) => renderNode(child, depth + 1))}
            </Box>
          )}
        </Box>
      );
    };

    if (!tree) return <Text>Loading...</Text>;

    return (
      <ScrollArea style={{ height: '600px', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
        {tree.map((node) => renderNode(node))}
      </ScrollArea>
    );
  };

  if (loading) {
    return (
      <Box style={{ padding: '24px' }}>
        <Text>Loading comparison data...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box style={{ padding: '24px', color: 'red' }}>
        <Text>Error: {error}</Text>
      </Box>
    );
  }

  return (
    <Box style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <Text as="div" size="8" weight="bold" style={{ marginBottom: '24px' }}>
        📊 模组树对比分析
      </Text>

      {/* Stats Comparison */}
      <Flex gap="4" style={{ marginBottom: '24px' }}>
        <Card style={{ flex: 1, padding: '16px' }}>
          <Text weight="bold" size="3">旧 API (Qwen)</Text>
          {oldStats && (
            <Box style={{ marginTop: '12px' }}>
              <Text size="2">📦 总节点: {oldStats.totalNodes}</Text>
              <Text size="2">📝 有内容: {oldStats.nodesWithContent} ({((oldStats.nodesWithContent / oldStats.totalNodes) * 100).toFixed(1)}%)</Text>
              <Text size="2">📄 内容长度: {oldStats.contentLength.toLocaleString()} 字符</Text>
              <Text size="2">📊 最大深度: {oldStats.maxDepth}</Text>
              <Text size="2">👶 平均子节点: {oldStats.avgChildrenPerNode}</Text>
            </Box>
          )}
        </Card>

        <Card style={{ flex: 1, padding: '16px' }}>
          <Text weight="bold" size="3">新 API (重新运行)</Text>
          {newStats && (
            <Box style={{ marginTop: '12px' }}>
              <Text size="2">📦 总节点: {newStats.totalNodes}</Text>
              <Text size="2">📝 有内容: {newStats.nodesWithContent} ({((newStats.nodesWithContent / newStats.totalNodes) * 100).toFixed(1)}%)</Text>
              <Text size="2">📄 内容长度: {newStats.contentLength.toLocaleString()} 字符</Text>
              <Text size="2">📊 最大深度: {newStats.maxDepth}</Text>
              <Text size="2">👶 平均子节点: {newStats.avgChildrenPerNode}</Text>
            </Box>
          )}
        </Card>

        <Card style={{ flex: 1, padding: '16px' }}>
          <Text weight="bold" size="3">✅ 差异</Text>
          {oldStats && newStats && (
            <Box style={{ marginTop: '12px' }}>
              <Text size="2">📦 节点数: {newStats.totalNodes - oldStats.totalNodes > 0 ? '+' : ''}{newStats.totalNodes - oldStats.totalNodes}</Text>
              <Text size="2">📝 有内容: {newStats.nodesWithContent - oldStats.nodesWithContent > 0 ? '+' : ''}{newStats.nodesWithContent - oldStats.nodesWithContent}</Text>
              <Text size="2">📄 内容长度: {newStats.contentLength - oldStats.contentLength > 0 ? '+' : ''}{(newStats.contentLength - oldStats.contentLength).toLocaleString()}</Text>
              <Text size="2">📊 最大深度: {newStats.maxDepth - oldStats.maxDepth > 0 ? '+' : ''}{newStats.maxDepth - oldStats.maxDepth}</Text>
            </Box>
          )}
        </Card>
      </Flex>

      {/* Tree Viewers */}
      <Tabs.Root defaultValue="comparison">
        <Tabs.List>
          <Tabs.Trigger value="comparison">对比视图</Tabs.Trigger>
          <Tabs.Trigger value="old">旧 API 树</Tabs.Trigger>
          <Tabs.Trigger value="new">新 API 树</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="comparison" style={{ marginTop: '16px' }}>
          <Flex gap="4">
            <Box style={{ flex: 1 }}>
              <Text weight="bold" style={{ marginBottom: '8px' }}>旧 API (Qwen)</Text>
              <TreeViewer tree={oldTree} title="Old Tree" />
            </Box>
            <Box style={{ flex: 1 }}>
              <Text weight="bold" style={{ marginBottom: '8px' }}>新 API (重新运行)</Text>
              <TreeViewer tree={newTree} title="New Tree" />
            </Box>
          </Flex>
        </Tabs.Content>

        <Tabs.Content value="old" style={{ marginTop: '16px' }}>
          <TreeViewer tree={oldTree} title="Old Tree" />
        </Tabs.Content>

        <Tabs.Content value="new" style={{ marginTop: '16px' }}>
          <TreeViewer tree={newTree} title="New Tree" />
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  );
}

