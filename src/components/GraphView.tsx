import './GraphView.css'
import { useVaultStore } from '../store/vaultStore'
import GraphVisualization from './GraphVisualization'

function GraphView() {
  const { graph, notes } = useVaultStore()

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <div className="graph-info">
          {graph ? (
            <>
              {graph.nodes.length} nodes, {graph.edges.length} edges
            </>
          ) : (
            'No graph data'
          )}
        </div>
      </div>

      <div className="graph-container">
        {!graph || notes.size === 0 ? (
          <div className="graph-empty">
            <p>No graph data available</p>
            <p className="hint">Add notes and links to build your knowledge graph</p>
          </div>
        ) : (
          <GraphVisualization mode="global" />
        )}
      </div>
    </div>
  )
}

export default GraphView
