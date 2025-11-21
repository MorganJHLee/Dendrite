import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { useVaultStore } from '../store/vaultStore'

interface LocalGraphVisualizationProps {
  noteId: string
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string
  label: string
  tags: string[]
  fx?: number | null
  fy?: number | null
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  source: string | D3Node
  target: string | D3Node
}

export default function LocalGraphVisualization({ noteId }: LocalGraphVisualizationProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null)
  const { graph, notes, setEditingNoteId, setSelectedNoteId } = useVaultStore()

  useEffect(() => {
    if (!svgRef.current || !graph || !noteId) return

    // Build local graph for this note
    const selectedNote = notes.get(noteId)
    if (!selectedNote) return

    const connectedNodeIds = new Set([noteId])

    // Add directly linked nodes
    selectedNote.links.forEach((link) => {
      const targetNote = Array.from(notes.values()).find(
        (n) => n.title === link || n.name === link || n.id === link
      )
      if (targetNote) connectedNodeIds.add(targetNote.id)
    })

    // Add backlinked nodes
    selectedNote.backlinks.forEach((id) => connectedNodeIds.add(id))

    const displayGraph = {
      nodes: graph.nodes.filter((node) => connectedNodeIds.has(node.id)),
      edges: graph.edges.filter(
        (edge) => connectedNodeIds.has(edge.source) && connectedNodeIds.has(edge.target)
      ),
    }

    // Convert to D3 format
    const d3Nodes: D3Node[] = displayGraph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      tags: node.data.tags,
    }))

    const d3Links: D3Link[] = displayGraph.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    }))

    // Clear previous content
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight

    // Create container for zoom
    const g = svg.append('g')

    // Create arrow marker for edges
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead-local')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 15)
      .attr('refY', 0)
      .attr('markerWidth', 4)
      .attr('markerHeight', 4)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'rgba(102, 126, 234, 0.3)')

    // Create force simulation (with smaller forces for sidebar)
    const simulation = d3.forceSimulation<D3Node>(d3Nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(d3Links)
        .id(d => d.id)
        .distance(40))
      .force('charge', d3.forceManyBody<D3Node>().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<D3Node>().radius(20))

    // Create links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(d3Links)
      .enter()
      .append('line')
      .attr('stroke', 'rgba(102, 126, 234, 0.3)')
      .attr('stroke-width', 1)
      .attr('marker-end', 'url(#arrowhead-local)')
      .style('opacity', 0.6)

    // Create node groups
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(d3Nodes)
      .enter()
      .append('g')
      .call(d3.drag<SVGGElement, D3Node>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended))

    // Add circles to nodes
    node.append('circle')
      .attr('r', d => d.id === noteId ? 6 : 4)
      .attr('fill', (d) => d.id === noteId ? '#764ba2' : '#667eea')
      .attr('stroke', (d) => d.id === noteId ? '#ffffff' : 'none')
      .attr('stroke-width', (d) => d.id === noteId ? 2 : 0)
      .style('cursor', 'pointer')

    // Add labels to nodes (smaller for sidebar)
    node.append('text')
      .text(d => {
        // Truncate long labels
        const maxLength = 15
        return d.label.length > maxLength ? d.label.substring(0, maxLength) + '...' : d.label
      })
      .attr('text-anchor', 'middle')
      .attr('dy', 12)
      .attr('font-size', '9px')
      .attr('font-weight', 600)
      .attr('fill', '#2d3748')
      .style('pointer-events', 'none')
      .style('user-select', 'none')

    // Node hover effects
    node.on('mouseover', function(_event, d) {
      d3.select(this).select('circle')
        .attr('r', d.id === noteId ? 7 : 5)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 2)

      // Highlight connected edges
      link
        .style('stroke', (l: any) =>
          (l.source.id === d.id || l.target.id === d.id)
            ? 'rgba(102, 126, 234, 0.8)'
            : 'rgba(102, 126, 234, 0.3)')
        .style('opacity', (l: any) =>
          (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.4)
    })

    node.on('mouseout', function(_event, d) {
      d3.select(this).select('circle')
        .attr('r', d.id === noteId ? 6 : 4)
        .attr('stroke', d.id === noteId ? '#ffffff' : 'none')
        .attr('stroke-width', d.id === noteId ? 2 : 0)

      // Reset edge styles
      link
        .style('stroke', 'rgba(102, 126, 234, 0.3)')
        .style('opacity', 0.6)
    })

    // Node click handler - open the note
    node.on('click', function(_event, d) {
      if (d.id !== noteId) {
        setEditingNoteId(d.id)
        setSelectedNoteId(d.id)
      }
    })

    // Drag functions
    function dragstarted(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      if (!event.active) simulation.alphaTarget(0.3).restart()
      d.fx = d.x
      d.fy = d.y
    }

    function dragged(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      d.fx = event.x
      d.fy = event.y
    }

    function dragended(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      if (!event.active) simulation.alphaTarget(0)
      // Keep the node fixed after dragging
      d.fx = d.x
      d.fy = d.y
    }

    // Update positions on each tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y)

      node.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    // Zoom behavior (less zoom range for sidebar)
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom)

    simulationRef.current = simulation

    // Cleanup
    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop()
        simulationRef.current = null
      }
    }
  }, [graph, noteId, notes, setEditingNoteId, setSelectedNoteId])

  return (
    <svg
      ref={svgRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#ffffff',
        borderRadius: '6px',
      }}
    />
  )
}
