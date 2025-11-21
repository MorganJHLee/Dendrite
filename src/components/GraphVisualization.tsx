import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { useVaultStore } from '../store/vaultStore'
import './GraphVisualization.css'

interface GraphVisualizationProps {
  mode: 'global' | 'local'
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

export default function GraphVisualization({ mode }: GraphVisualizationProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null)
  const { graph, selectedNoteId, setSelectedNoteId, notes } = useVaultStore()
  const filterTags: string[] = []

  useEffect(() => {
    if (!svgRef.current || !graph) return

    // Determine which graph to display
    let displayGraph = graph

    if (mode === 'local' && selectedNoteId) {
      // Filter graph to show only connected nodes
      const selectedNote = notes.get(selectedNoteId)
      if (selectedNote) {
        const connectedNodeIds = new Set([selectedNoteId])

        // Add directly linked nodes
        selectedNote.links.forEach((link) => {
          const targetNote = Array.from(notes.values()).find(
            (n) => n.title === link || n.name === link || n.id === link
          )
          if (targetNote) connectedNodeIds.add(targetNote.id)
        })

        // Add backlinked nodes
        selectedNote.backlinks.forEach((id) => connectedNodeIds.add(id))

        displayGraph = {
          nodes: graph.nodes.filter((node) => connectedNodeIds.has(node.id)),
          edges: graph.edges.filter(
            (edge) => connectedNodeIds.has(edge.source) && connectedNodeIds.has(edge.target)
          ),
        }
      }
    }

    // Apply tag filter if any
    if (filterTags.length > 0) {
      displayGraph = {
        nodes: displayGraph.nodes.filter((node) =>
          node.data.tags.some((tag) => filterTags.includes(tag))
        ),
        edges: displayGraph.edges.filter(
          (edge) =>
            displayGraph.nodes.some((n) => n.id === edge.source) &&
            displayGraph.nodes.some((n) => n.id === edge.target)
        ),
      }
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
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'rgba(102, 126, 234, 0.25)')

    // Create selected arrow marker
    svg.select('defs').append('marker')
      .attr('id', 'arrowhead-selected')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#667eea')

    // Create force simulation
    const simulation = d3.forceSimulation<D3Node>(d3Nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(d3Links)
        .id(d => d.id)
        .distance(100))
      .force('charge', d3.forceManyBody<D3Node>().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<D3Node>().radius(30))

    // Create links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(d3Links)
      .enter()
      .append('line')
      .attr('stroke', 'rgba(102, 126, 234, 0.25)')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrowhead)')
      .style('opacity', 0.6)
      .style('transition', 'all 200ms ease-out')

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
      .attr('r', 6)
      .attr('fill', (d) => d.id === selectedNoteId ? '#764ba2' : '#667eea')
      .attr('stroke', (d) => d.id === selectedNoteId ? '#ffffff' : 'none')
      .attr('stroke-width', (d) => d.id === selectedNoteId ? 3 : 0)
      .style('cursor', 'grab')
      .style('transition', 'all 200ms ease-out')

    // Add labels to nodes
    node.append('text')
      .text(d => d.label)
      .attr('text-anchor', 'middle')
      .attr('dy', 16)
      .attr('font-size', '11px')
      .attr('font-weight', 600)
      .attr('fill', '#2d3748')
      .style('pointer-events', 'none')
      .style('user-select', 'none')
      .each(function(d) {
        // Wrap text if it's too long
        const text = d3.select(this)
        const words = d.label.split(/\s+/)
        const maxWidth = 100
        let line: string[] = []
        let lineNumber = 0
        const lineHeight = 1.1
        const y = text.attr('y')
        const dy = parseFloat(text.attr('dy'))
        let tspan = text.text(null).append('tspan').attr('x', 0).attr('y', y).attr('dy', dy + 'px')

        words.forEach((word) => {
          line.push(word)
          tspan.text(line.join(' '))
          if (tspan.node()!.getComputedTextLength() > maxWidth && line.length > 1) {
            line.pop()
            tspan.text(line.join(' '))
            line = [word]
            tspan = text.append('tspan')
              .attr('x', 0)
              .attr('y', y)
              .attr('dy', ++lineNumber * lineHeight + dy + 'px')
              .text(word)
          }
        })
      })

    // Node hover effects
    node.on('mouseover', function(_event, d) {
      if (d.id !== selectedNoteId) {
        d3.select(this).select('circle')
          .attr('r', 7)
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 2)
      }
      // Highlight connected edges
      link
        .style('stroke', (l: any) =>
          (l.source.id === d.id || l.target.id === d.id)
            ? 'rgba(102, 126, 234, 0.6)'
            : 'rgba(102, 126, 234, 0.25)')
        .style('stroke-width', (l: any) =>
          (l.source.id === d.id || l.target.id === d.id) ? 2 : 1.5)
        .style('opacity', (l: any) =>
          (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.6)
    })

    node.on('mouseout', function(_event, d) {
      if (d.id !== selectedNoteId) {
        d3.select(this).select('circle')
          .attr('r', 6)
          .attr('stroke', 'none')
          .attr('stroke-width', 0)
      }
      // Reset edge styles
      link
        .style('stroke', 'rgba(102, 126, 234, 0.25)')
        .style('stroke-width', 1.5)
        .style('opacity', 0.6)
    })

    // Node click handler
    node.on('click', function(_event, d) {
      setSelectedNoteId(d.id)

      // Update all nodes
      node.select('circle')
        .attr('r', 6)
        .attr('fill', '#667eea')
        .attr('stroke', 'none')
        .attr('stroke-width', 0)

      // Highlight selected node
      d3.select(this).select('circle')
        .attr('r', 8)
        .attr('fill', '#764ba2')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 3)
    })

    // Drag functions
    function dragstarted(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      if (!event.active) simulation.alphaTarget(0.3).restart()
      d.fx = d.x
      d.fy = d.y
      d3.select(event.sourceEvent.target.parentNode as SVGGElement)
        .select('circle')
        .style('cursor', 'grabbing')
        .attr('r', 8)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 3)
    }

    function dragged(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      d.fx = event.x
      d.fy = event.y
    }

    function dragended(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      if (!event.active) simulation.alphaTarget(0)
      // Keep the node fixed after dragging
      // If you want it to be free again, uncomment these lines:
      // d.fx = null
      // d.fy = null
      d3.select(event.sourceEvent.target.parentNode as SVGGElement)
        .select('circle')
        .style('cursor', 'grab')
        .attr('r', d.id === selectedNoteId ? 8 : 6)
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

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
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
  }, [graph, mode, selectedNoteId, notes, filterTags, setSelectedNoteId])

  const handleResetView = () => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.transition()
      .duration(750)
      .call(
        d3.zoom<SVGSVGElement, unknown>().transform as any,
        d3.zoomIdentity
      )
  }

  const handleRelayout = () => {
    if (simulationRef.current) {
      // Unfix all nodes
      simulationRef.current.nodes().forEach(node => {
        node.fx = null
        node.fy = null
      })
      // Restart simulation with higher alpha
      simulationRef.current.alpha(1).restart()
    }
  }

  return (
    <div className="graph-visualization">
      <div className="graph-controls">
        <button className="btn-sm" onClick={handleResetView}>
          Reset View
        </button>
        <button className="btn-sm" onClick={handleRelayout}>
          Relayout
        </button>
      </div>
      <svg ref={svgRef} className="d3-container" />
    </div>
  )
}
