import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { PdfCard, HighlightCard, PdfHighlight } from '../types'
import { loadPdfDocument, renderTextLayer } from '../services/pdfService'
import { useVaultStore } from '../store/vaultStore'
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Menu,
  Search,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  Highlighter,
} from 'lucide-react'
import './PdfReaderModal.css'

interface PdfReaderModalProps {
  pdfCard: PdfCard
  onClose: () => void
  onUpdateReadingPosition: (page: number, scrollPosition: number) => void
  // Optional navigation target (for "Go to Source" from highlight cards)
  navigationTarget?: {
    page: number
    scrollPosition?: number
  }
}

interface TextSelection {
  text: string
  pageNumber: number
  boundingRects: DOMRect[]
  range: Range
}

interface OutlineItem {
  title: string
  dest: any
  items?: OutlineItem[]
  pageNumber?: number
}

export function PdfReaderModal({
  pdfCard,
  onClose,
  onUpdateReadingPosition,
  navigationTarget,
}: PdfReaderModalProps) {
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  // Use navigationTarget if provided, otherwise use last read page
  const initialPage = navigationTarget?.page || pdfCard.lastReadPage || 1
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [scale, setScale] = useState(2.0) // Higher zoom for native clarity at screen DPI
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [showSidebar, setShowSidebar] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isClosing, setIsClosing] = useState(false)
  const [renderedPages, setRenderedPages] = useState<Set<number>>(new Set())
  const [isInitialRenderComplete, setIsInitialRenderComplete] = useState(false)
  const [showFloatingPageNumber, setShowFloatingPageNumber] = useState(false)
  const [selectedText, setSelectedText] = useState<TextSelection | null>(null)
  const [highlightButtonPosition, setHighlightButtonPosition] = useState<{ x: number; y: number } | null>(null)
  const [selectedColor, setSelectedColor] = useState('#fef3c7') // Default yellow
  const [highlightContextMenu, setHighlightContextMenu] = useState<{ x: number; y: number; highlightId: string } | null>(null)

  // Access vault store for creating and deleting highlight cards
  const { addHighlightCard, activeWhiteboardId, updatePdfCard, deleteHighlightCard } = useVaultStore()

  const viewerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Map<number, HTMLCanvasElement>>(new Map())
  const pageContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const highlightLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const renderTasksRef = useRef<Map<number, any>>(new Map())
  const renderingPagesRef = useRef<Set<number>>(new Set()) // Track pages currently being rendered
  const currentPageRef = useRef<number>(currentPage)
  const scrollHideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const scrollRestoredRef = useRef<boolean>(false)
  // Capture the initial scroll position to restore - use navigationTarget if provided
  const initialScrollPositionRef = useRef<number | undefined>(
    navigationTarget?.scrollPosition !== undefined
      ? navigationTarget.scrollPosition
      : pdfCard.lastScrollPosition
  )
  const initialScrollPageRef = useRef<number | undefined>(
    navigationTarget?.page || pdfCard.lastReadPage
  )

  // Load PDF document
  useEffect(() => {
    let mounted = true

    // Reset scroll restoration state when loading a new PDF
    scrollRestoredRef.current = false
    // Use navigationTarget if provided, otherwise use lastReadPosition
    initialScrollPositionRef.current = navigationTarget?.scrollPosition !== undefined
      ? navigationTarget.scrollPosition
      : pdfCard.lastScrollPosition
    initialScrollPageRef.current = navigationTarget?.page || pdfCard.lastReadPage

    const loadPdf = async () => {
      try {
        const doc = await loadPdfDocument(pdfCard.pdfPath)
        if (mounted) {
          setPdfDoc(doc)

          // Extract outline/table of contents
          try {
            const pdfOutline = await doc.getOutline()
            if (pdfOutline) {
              const parsedOutline = await parseOutline(pdfOutline, doc)
              setOutline(parsedOutline)
            }
          } catch (error) {
            console.error('Error loading outline:', error)
          }
        }
      } catch (error) {
        console.error('Error loading PDF:', error)
      }
    }

    loadPdf()

    return () => {
      mounted = false
    }
  }, [pdfCard.pdfPath])

  // Set initial scroll position immediately when viewer is ready - BEFORE rendering pages
  // This prevents the flash of showing page 1 before relocating to the saved position
  useEffect(() => {
    if (!viewerRef.current || initialScrollPositionRef.current === undefined) {
      return
    }

    // Use requestAnimationFrame to ensure the viewer's layout is ready
    requestAnimationFrame(() => {
      if (viewerRef.current && initialScrollPositionRef.current !== undefined) {
        // Set scroll position immediately, before any pages are rendered
        // This way the viewer is already at the correct position when pages start appearing
        viewerRef.current.scrollTop = initialScrollPositionRef.current
        console.log(`[PreScroll] Set initial scroll position to ${initialScrollPositionRef.current}px immediately`)
      }
    })
  }, []) // Empty deps - only run once on mount when viewerRef becomes available

  // Parse outline to get page numbers
  const parseOutline = async (
    items: any[],
    doc: any
  ): Promise<OutlineItem[]> => {
    const parsed: OutlineItem[] = []

    for (const item of items) {
      const outlineItem: OutlineItem = {
        title: item.title,
        dest: item.dest,
        items: item.items ? await parseOutline(item.items, doc) : undefined,
      }

      // Get page number from destination
      if (item.dest) {
        try {
          let dest = item.dest
          if (typeof dest === 'string') {
            dest = await doc.getDestination(dest)
          }
          if (dest && dest[0]) {
            const pageIndex = await doc.getPageIndex(dest[0])
            outlineItem.pageNumber = pageIndex + 1 // Convert to 1-indexed
          }
        } catch (error) {
          console.error('Error getting page number for outline item:', error)
        }
      }

      parsed.push(outlineItem)
    }

    return parsed
  }

  // Render a single page with high-DPI support
  const renderPage = useCallback(async (pageNumber: number) => {
    if (!pdfDoc) return

    const canvas = pageRefs.current.get(pageNumber)
    if (!canvas) return

    // Skip if this page is already being rendered
    if (renderingPagesRef.current.has(pageNumber)) {
      console.log(`[renderPage] Page ${pageNumber} already rendering, skipping`)
      return
    }

    // Mark page as being rendered
    renderingPagesRef.current.add(pageNumber)

    // Cancel any existing render task for this page before starting a new one
    // This avoids "Cannot use the same canvas during multiple render() operations" error
    const existingTask = renderTasksRef.current.get(pageNumber)
    if (existingTask) {
      try {
        existingTask.cancel()
      } catch (e) {
        // Ignore cancellation errors
      }
      renderTasksRef.current.delete(pageNumber)
      // Wait a bit for the cancellation to take effect
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    try {
      const page = await pdfDoc.getPage(pageNumber)
      const viewport = page.getViewport({ scale })

      const context = canvas.getContext('2d')
      if (!context) return

      // Render at native screen DPI for crisp text without blur
      const pixelRatio = window.devicePixelRatio || 1

      // No quality multiplier - render at actual screen resolution
      // Use higher PDF zoom instead of canvas scaling to avoid blur
      const renderScale = pixelRatio
      const newWidth = viewport.width * renderScale
      const newHeight = viewport.height * renderScale

      // Only resize if dimensions changed (prevents flashing)
      if (canvas.width !== newWidth || canvas.height !== newHeight) {
        canvas.width = newWidth
        canvas.height = newHeight
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
      }

      // Enable anti-aliasing for smooth text edges
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'

      // Clear and scale context to account for pixel ratio and quality
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.save()
      context.scale(renderScale, renderScale)

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      }

      const renderTask = page.render(renderContext)
      renderTasksRef.current.set(pageNumber, renderTask)
      await renderTask.promise
      context.restore()

      // Mark page as rendered NOW so the container becomes visible (display: block)
      // This is critical - the container has display:none until page is in renderedPages,
      // which causes getBoundingClientRect() to return 0x0 dimensions
      setRenderedPages(prev => new Set(prev).add(pageNumber))

      // Render text layer for selection using the official PDF.js API
      const textLayerDiv = textLayerRefs.current.get(pageNumber)
      if (textLayerDiv) {
        try {
          console.log(`[renderPage] Page ${pageNumber} starting text layer render`)
          await renderTextLayer(page, textLayerDiv, viewport)
          console.log(`[renderPage] Page ${pageNumber} text layer render complete, children:`, textLayerDiv.children.length)

          // Fix coordinate mismatch: scale text layer to match actual canvas display size
          // The canvas may be scaled down by maxWidth: '100%', but the text layer has fixed dimensions
          // This causes text selection to be offset when the sidebar is visible

          // Wait for canvas to have non-zero dimensions before applying transform
          // Now that page is marked as rendered, container should be visible immediately
          // But we still need to wait for browser layout to complete
          const waitForCanvasLayout = async () => {
            const maxAttempts = 20
            const delayMs = 5  // Check every 5ms for up to 100ms total

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              // On first attempt, try immediately with double rAF
              if (attempt === 0) {
                await new Promise<void>(resolve => {
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
                })
              } else {
                await new Promise(resolve => setTimeout(resolve, delayMs))
              }

              // Force layout recalculation
              void canvas.offsetHeight

              const canvasRect = canvas.getBoundingClientRect()

              if (canvasRect.width > 0 && canvasRect.height > 0) {
                const scaleX = canvasRect.width / viewport.width
                const scaleY = canvasRect.height / viewport.height

                console.log(`[renderPage] Page ${pageNumber} text layer scaling (attempt ${attempt + 1}):`, {
                  canvasRect: { width: canvasRect.width, height: canvasRect.height },
                  viewport: { width: viewport.width, height: viewport.height },
                  scale: { x: scaleX, y: scaleY },
                  timeMs: attempt === 0 ? 'immediate (rAF)' : `${attempt * delayMs}ms`
                })

                // Apply transform to scale text layer to match canvas
                textLayerDiv.style.transform = `scale(${scaleX}, ${scaleY})`
                textLayerDiv.style.transformOrigin = '0 0'

                console.log(`[renderPage] Page ${pageNumber} applied transform:`, textLayerDiv.style.transform)
                return
              } else if (attempt < 5) {
                // Log first few attempts to see timing
                console.log(`[renderPage] Page ${pageNumber} canvas not ready (attempt ${attempt + 1}), dimensions:`,
                  canvasRect.width, 'x', canvasRect.height)
              }
            }

            console.error(`[renderPage] Page ${pageNumber} canvas never got non-zero dimensions after ${maxAttempts} attempts`)
          }

          await waitForCanvasLayout()

          // Apply the same transform and dimensions to the highlight layer as the text layer
          const highlightLayer = highlightLayerRefs.current.get(pageNumber)
          if (highlightLayer) {
            // Set highlight layer dimensions to match viewport (same as text layer)
            highlightLayer.style.width = `${viewport.width}px`
            highlightLayer.style.height = `${viewport.height}px`
            // Apply the same transform as the text layer
            highlightLayer.style.transform = textLayerDiv.style.transform
            highlightLayer.style.transformOrigin = textLayerDiv.style.transformOrigin
          }
        } catch (error) {
          console.error('Error rendering text layer:', error)
        }
      }

      // Render highlights for this page now that the page is fully rendered
      renderHighlightsForPage(pageNumber)

      // Page already marked as rendered earlier (before text layer processing)
    } catch (error: any) {
      if (error?.name !== 'RenderingCancelledException') {
        console.error(`Error rendering page ${pageNumber}:`, error)
      }
    } finally {
      // Always clean up the render task and rendering flag, even if cancelled or errored
      renderTasksRef.current.delete(pageNumber)
      renderingPagesRef.current.delete(pageNumber)
    }
  }, [pdfDoc, scale])

  // Intelligent pre-rendering: render initial pages immediately for better UX
  // CRITICAL: Render the last read page FIRST to enable accurate scroll restoration
  useEffect(() => {
    if (!pdfDoc || isInitialRenderComplete) return

    const performInitialRender = async () => {
      const totalPages = pdfCard.pageCount
      const savedPage = initialScrollPageRef.current || 1

      // For small PDFs (< 50 pages), render all pages sequentially
      // Sequential rendering prevents PDF.js canvas conflicts
      if (totalPages < 50) {
        for (let i = 1; i <= totalPages; i++) {
          await renderPage(i)
        }
      } else {
        // For larger PDFs, prioritize rendering the saved page first
        // This ensures we can accurately restore scroll position

        // 1. Render the saved page first
        await renderPage(savedPage)

        // 2. Render a few pages before and after for context (if they exist)
        const renderPromises = []
        for (let offset = 1; offset <= 2; offset++) {
          if (savedPage - offset >= 1) {
            renderPromises.push(renderPage(savedPage - offset))
          }
          if (savedPage + offset <= totalPages) {
            renderPromises.push(renderPage(savedPage + offset))
          }
        }
        await Promise.all(renderPromises)

        // 3. Render first few pages if we haven't already (for quick access)
        if (savedPage > 5) {
          for (let i = 1; i <= 3; i++) {
            await renderPage(i)
          }
        }
      }

      setIsInitialRenderComplete(true)
    }

    // Start rendering immediately - no delay needed
    performInitialRender()

    return () => {
      // Cancel any ongoing render tasks if this effect is cleaned up
      renderTasksRef.current.forEach(task => {
        task.cancel()
      })
      renderTasksRef.current.clear()
    }
  }, [pdfDoc, pdfCard.pageCount, renderPage, isInitialRenderComplete])

  // Lazy render pages as they become visible with aggressive pre-rendering
  useEffect(() => {
    if (!pdfDoc) return

    // Clear rendered pages when scale changes to force re-render
    setRenderedPages(new Set())
    setIsInitialRenderComplete(false)

    const renderedSet = new Set<number>()

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.getAttribute('data-page') || '0')
            if (pageNum > 0 && !renderedSet.has(pageNum)) {
              renderedSet.add(pageNum)
              renderPage(pageNum)
            }
          }
        })
      },
      {
        root: viewerRef.current,
        rootMargin: '3000px', // Aggressive pre-rendering: render 3000px before page is visible
        threshold: 0.01,
      }
    )

    // Observe all page containers
    pageContainerRefs.current.forEach(container => {
      observer.observe(container)
    })

    return () => {
      observer.disconnect()
      // Cancel all ongoing render tasks when scale changes
      renderTasksRef.current.forEach(task => {
        task.cancel()
      })
      renderTasksRef.current.clear()
    }
  }, [pdfDoc, scale, renderPage])

  // Keep currentPageRef in sync
  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  // Update text layer and highlight layer scaling when sidebar is toggled or window resizes
  useEffect(() => {
    if (!pdfDoc) return

    const updateTextLayerScaling = async () => {
      // Wait for layout to settle after sidebar toggle
      await new Promise(resolve => setTimeout(resolve, 50))

      console.log('[updateTextLayerScaling] Starting update, rendered pages:', Array.from(textLayerRefs.current.keys()))

      // Update all rendered text layers and highlight layers
      for (const [pageNum, textLayerDiv] of textLayerRefs.current.entries()) {
        const canvas = pageRefs.current.get(pageNum)
        if (!canvas || !textLayerDiv) continue

        try {
          // Get the page to access viewport
          const page = await pdfDoc.getPage(pageNum)
          const viewport = page.getViewport({ scale })

          // Force layout recalculation for accurate measurements
          void canvas.offsetHeight

          // Calculate scale based on actual canvas display size
          const canvasRect = canvas.getBoundingClientRect()
          const scaleX = canvasRect.width / viewport.width
          const scaleY = canvasRect.height / viewport.height

          console.log(`[updateTextLayerScaling] Page ${pageNum}:`, {
            canvasRect: { width: canvasRect.width, height: canvasRect.height },
            viewport: { width: viewport.width, height: viewport.height },
            scale: { x: scaleX, y: scaleY }
          })

          // Apply transform to text layer
          textLayerDiv.style.transform = `scale(${scaleX}, ${scaleY})`
          textLayerDiv.style.transformOrigin = '0 0'

          // Also apply the same transform to highlight layer
          const highlightLayer = highlightLayerRefs.current.get(pageNum)
          if (highlightLayer) {
            highlightLayer.style.transform = `scale(${scaleX}, ${scaleY})`
            highlightLayer.style.transformOrigin = '0 0'
          }
        } catch (error) {
          // Ignore errors for pages that haven't been loaded yet
        }
      }
    }

    updateTextLayerScaling()

    // Also update on window resize
    const handleResize = () => {
      updateTextLayerScaling()
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [pdfDoc, showSidebar, scale])

  // Ensure text layer and highlight layer scaling is correct after initial render completes
  useEffect(() => {
    if (!pdfDoc || !isInitialRenderComplete) return

    console.log('[finalizeTextLayers] Starting finalization')

    const finalizeTextLayers = async () => {
      // Give browser extra time to finish all layout calculations
      await new Promise(resolve => setTimeout(resolve, 100))

      console.log('[finalizeTextLayers] After 100ms delay, processing pages:', Array.from(textLayerRefs.current.keys()))

      // Update all rendered text layers and highlight layers with double rAF for accuracy
      for (const [pageNum, textLayerDiv] of textLayerRefs.current.entries()) {
        const canvas = pageRefs.current.get(pageNum)
        if (!canvas || !textLayerDiv) continue

        try {
          const page = await pdfDoc.getPage(pageNum)
          const viewport = page.getViewport({ scale })

          // Use double rAF to ensure layout is complete
          await new Promise<void>(resolve => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                void canvas.offsetHeight
                const canvasRect = canvas.getBoundingClientRect()
                const scaleX = canvasRect.width / viewport.width
                const scaleY = canvasRect.height / viewport.height

                console.log(`[finalizeTextLayers] Page ${pageNum}:`, {
                  canvasRect: { width: canvasRect.width, height: canvasRect.height },
                  viewport: { width: viewport.width, height: viewport.height },
                  scale: { x: scaleX, y: scaleY },
                  textLayerChildren: textLayerDiv.children.length,
                  textLayerPointerEvents: textLayerDiv.style.pointerEvents
                })

                textLayerDiv.style.transform = `scale(${scaleX}, ${scaleY})`
                textLayerDiv.style.transformOrigin = '0 0'

                // Also apply the same transform to highlight layer
                const highlightLayer = highlightLayerRefs.current.get(pageNum)
                if (highlightLayer) {
                  highlightLayer.style.transform = `scale(${scaleX}, ${scaleY})`
                  highlightLayer.style.transformOrigin = '0 0'
                }

                console.log(`[finalizeTextLayers] Page ${pageNum} applied transform:`, textLayerDiv.style.transform)
                resolve()
              })
            })
          })
        } catch (error) {
          console.error(`[finalizeTextLayers] Error on page ${pageNum}:`, error)
        }
      }

      console.log('[finalizeTextLayers] Finalization complete')
    }

    finalizeTextLayers()
  }, [pdfDoc, isInitialRenderComplete, scale])

  // Track current page based on scroll position
  // Use scroll event to check ALL page containers and find the one closest to viewport top
  useEffect(() => {
    if (!pdfDoc) return

    const viewer = viewerRef.current
    if (!viewer) return

    const updateCurrentPage = () => {
      const viewerRect = viewer.getBoundingClientRect()
      const viewerTop = viewerRect.top
      const viewerCenter = viewerTop + viewerRect.height / 2

      let closestPage = 1
      let minDistance = Infinity

      // Check ALL page containers to find which one is closest to the center of the viewport
      pageContainerRefs.current.forEach((container, pageNum) => {
        const rect = container.getBoundingClientRect()

        // Only consider pages that are actually visible in the viewport
        if (rect.bottom > viewerTop && rect.top < viewerTop + viewerRect.height) {
          // Calculate distance from page center to viewport center
          const pageCenter = rect.top + rect.height / 2
          const distance = Math.abs(pageCenter - viewerCenter)

          if (distance < minDistance) {
            minDistance = distance
            closestPage = pageNum
          }
        }
      })

      if (closestPage !== currentPageRef.current) {
        setCurrentPage(closestPage)
      }
    }

    // Use requestAnimationFrame to throttle scroll updates and prevent excessive re-renders
    let rafId: number | null = null
    const handleScroll = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      rafId = requestAnimationFrame(updateCurrentPage)
    }

    // Initial page detection
    updateCurrentPage()

    viewer.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      viewer.removeEventListener('scroll', handleScroll)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [pdfDoc])

  // Restore scroll position - wait for saved page to render, then restore ONCE
  // CRITICAL: Only depends on isInitialRenderComplete to avoid re-triggering during scrolling
  // Uses refs to capture initial position, not props that change during scrolling
  useEffect(() => {
    if (!viewerRef.current || initialScrollPositionRef.current === undefined || !pdfDoc) {
      return
    }

    // Only restore once per PDF load
    if (scrollRestoredRef.current) {
      return
    }

    // Wait for initial render to complete (which includes rendering the saved page)
    if (!isInitialRenderComplete) {
      return
    }

    // Use the captured initial values, not the live props
    const savedPosition = initialScrollPositionRef.current
    const savedPage = initialScrollPageRef.current || 1

    // At this point, the saved page should be rendered (prioritized in initial render)
    // Use requestAnimationFrame for better timing with browser layout
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (viewerRef.current && !scrollRestoredRef.current) {
          viewerRef.current.scrollTop = savedPosition
          scrollRestoredRef.current = true
          console.log(`[ScrollRestore] Restored scroll position ${savedPosition}px to page ${savedPage}`)
        }
      })
    })
  }, [pdfDoc, isInitialRenderComplete])

  // Save reading position when scrolling (throttled) and show/hide floating page number
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    let scrollTimeout: NodeJS.Timeout | null = null
    const handleScroll = () => {
      // Show floating page number on scroll
      setShowFloatingPageNumber(true)

      // Clear existing hide timeout
      if (scrollHideTimeoutRef.current) {
        clearTimeout(scrollHideTimeoutRef.current)
      }

      // Hide after 2.5 seconds of no scrolling
      scrollHideTimeoutRef.current = setTimeout(() => {
        setShowFloatingPageNumber(false)
      }, 2500)

      // Save reading position (throttled)
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }
      scrollTimeout = setTimeout(() => {
        onUpdateReadingPosition(currentPageRef.current, viewer.scrollTop)
      }, 100)
    }

    viewer.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      viewer.removeEventListener('scroll', handleScroll)
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }
      if (scrollHideTimeoutRef.current) {
        clearTimeout(scrollHideTimeoutRef.current)
      }
    }
  }, [onUpdateReadingPosition])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in search
      if (e.target instanceof HTMLInputElement) return

      const viewer = viewerRef.current
      if (!viewer) return

      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault()
          // Scroll up by viewport height
          viewer.scrollBy({ top: -viewer.clientHeight * 0.9, behavior: 'smooth' })
          break
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault()
          // Scroll down by viewport height
          viewer.scrollBy({ top: viewer.clientHeight * 0.9, behavior: 'smooth' })
          break
        case 'PageUp':
          e.preventDefault()
          viewer.scrollBy({ top: -viewer.clientHeight, behavior: 'smooth' })
          break
        case 'PageDown':
        case ' ':
          e.preventDefault()
          viewer.scrollBy({ top: viewer.clientHeight, behavior: 'smooth' })
          break
        case 'Home':
          e.preventDefault()
          viewer.scrollTo({ top: 0, behavior: 'smooth' })
          break
        case 'End':
          e.preventDefault()
          viewer.scrollTo({ top: viewer.scrollHeight, behavior: 'smooth' })
          break
        case '+':
        case '=':
          e.preventDefault()
          handleZoomIn()
          break
        case '-':
          e.preventDefault()
          handleZoomOut()
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [scale, onClose])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel all ongoing render tasks
      renderTasksRef.current.forEach(task => {
        task.cancel()
      })
      renderTasksRef.current.clear()

      if (pdfDoc) {
        pdfDoc.destroy()
      }
    }
  }, [pdfDoc])

  const handlePreviousPage = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // Scroll up by viewport height
    viewer.scrollBy({ top: -viewer.clientHeight * 0.9, behavior: 'smooth' })
  }, [])

  const handleNextPage = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // Scroll down by viewport height
    viewer.scrollBy({ top: viewer.clientHeight * 0.9, behavior: 'smooth' })
  }, [])

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.25, 3.0))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.25, 0.5))
  }, [])

  const handleOutlineClick = useCallback((pageNumber: number) => {
    const container = pageContainerRefs.current.get(pageNumber)
    if (container && viewerRef.current) {
      // Scroll to the specific page
      container.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const handleClose = useCallback(() => {
    // Trigger closing animation
    setIsClosing(true)

    // Save final reading position
    if (viewerRef.current) {
      onUpdateReadingPosition(currentPage, viewerRef.current.scrollTop)
    }

    // Wait for animation to complete before calling onClose
    setTimeout(() => {
      onClose()
    }, 200) // Match --transition-fast (0.2s)
  }, [currentPage, onClose, onUpdateReadingPosition])

  // Handle text selection for highlight creation
  useEffect(() => {
    const handleTextSelection = () => {
      const selection = window.getSelection()
      if (!selection || selection.toString().trim().length === 0) {
        setSelectedText(null)
        setHighlightButtonPosition(null)
        return
      }

      const selectedText = selection.toString().trim()
      const range = selection.getRangeAt(0)

      // Get all bounding rectangles (for multi-line selections)
      const rects = range.getClientRects()
      const rectArray: DOMRect[] = []
      for (let i = 0; i < rects.length; i++) {
        rectArray.push(rects[i] as DOMRect)
      }

      // Find which page contains this selection
      let pageNumber = currentPage
      textLayerRefs.current.forEach((textLayer, pageNum) => {
        if (textLayer.contains(range.commonAncestorContainer as Node)) {
          pageNumber = pageNum
        }
      })

      // Get the last rect for button positioning
      const lastRect = rectArray[rectArray.length - 1] || range.getBoundingClientRect()

      setSelectedText({
        text: selectedText,
        pageNumber,
        boundingRects: rectArray,
        range: range.cloneRange(),
      })

      // Position the button near the end of selection
      setHighlightButtonPosition({
        x: lastRect.right + 10,
        y: lastRect.top - 80, // More space for color picker
      })
    }

    document.addEventListener('mouseup', handleTextSelection)
    document.addEventListener('touchend', handleTextSelection)

    return () => {
      document.removeEventListener('mouseup', handleTextSelection)
      document.removeEventListener('touchend', handleTextSelection)
    }
  }, [currentPage])

  // Close context menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!highlightContextMenu) return

    const handleClickOutside = (e: MouseEvent) => {
      // Check if click is outside the context menu
      const target = e.target as HTMLElement
      const contextMenuElement = document.querySelector('[data-context-menu="highlight"]')

      if (contextMenuElement && !contextMenuElement.contains(target)) {
        setHighlightContextMenu(null)
      }
    }

    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHighlightContextMenu(null)
      }
    }

    // Use requestAnimationFrame to ensure the menu is rendered before adding listeners
    // This prevents the same click that opened the menu from immediately closing it
    let rafId: number
    const timeoutId = setTimeout(() => {
      rafId = requestAnimationFrame(() => {
        document.addEventListener('mousedown', handleClickOutside, true)
        document.addEventListener('keydown', handleEscapeKey)
      })
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId)
      }
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleEscapeKey)
    }
  }, [highlightContextMenu])

  // Create highlight card from selection
  const handleCreateHighlight = useCallback(() => {
    if (!selectedText || !activeWhiteboardId || !viewerRef.current) return

    const highlightId = `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Get the text layer for this page to convert client coordinates to layer-relative coordinates
    const textLayer = textLayerRefs.current.get(selectedText.pageNumber)
    if (!textLayer) {
      console.error('Text layer not found for page', selectedText.pageNumber)
      return
    }

    const textLayerRect = textLayer.getBoundingClientRect()

    // Extract the scale from the text layer's transform to convert coordinates correctly
    const transform = textLayer.style.transform
    let scaleX = 1
    let scaleY = 1
    if (transform) {
      const match = transform.match(/scale\(([^,]+),\s*([^)]+)\)/)
      if (match) {
        scaleX = parseFloat(match[1])
        scaleY = parseFloat(match[2])
      }
    }

    // Create highlight data for storing in PDF
    // Convert client coordinates to layer-relative coordinates, accounting for transform
    const pdfHighlight: PdfHighlight = {
      id: highlightId,
      text: selectedText.text,
      color: selectedColor,
      pageNumber: selectedText.pageNumber,
      rects: selectedText.boundingRects.map(rect => {
        // Get position relative to text layer, then divide by scale to get internal coordinates
        const relativeLeft = (rect.left - textLayerRect.left) / scaleX
        const relativeTop = (rect.top - textLayerRect.top) / scaleY
        const relativeWidth = rect.width / scaleX
        const relativeHeight = rect.height / scaleY
        // Return plain object without methods to avoid "An object could not be cloned" errors
        return {
          x: relativeLeft,
          y: relativeTop,
          left: relativeLeft,
          top: relativeTop,
          width: relativeWidth,
          height: relativeHeight,
          right: relativeLeft + relativeWidth,
          bottom: relativeTop + relativeHeight,
        } as DOMRect
      }),
      textDivIndices: [], // Will be populated when rendering
    }

    // Update PDF card with new highlight
    const currentHighlights = pdfCard.highlights || []
    updatePdfCard(pdfCard.id, {
      highlights: [...currentHighlights, pdfHighlight],
      modifiedAt: new Date(),
    })

    // Create highlight card
    const firstRect = selectedText.boundingRects[0]
    const highlightCard: HighlightCard = {
      id: highlightId,
      whiteboardId: activeWhiteboardId,
      sourcePdfCardId: pdfCard.id,
      highlightedText: selectedText.text,
      pageNumber: selectedText.pageNumber,
      color: selectedColor,
      x: pdfCard.x + pdfCard.width + 50, // Position to the right of the PDF card
      y: pdfCard.y,
      width: 300,
      height: 200,
      createdAt: new Date(),
      modifiedAt: new Date(),
      scrollPosition: viewerRef.current.scrollTop,
      boundingRect: firstRect ? {
        left: firstRect.left,
        top: firstRect.top,
        width: firstRect.width,
        height: firstRect.height,
      } : undefined,
    }

    addHighlightCard(highlightCard)

    // Render the highlight overlay immediately
    renderHighlightOverlay(pdfHighlight)

    // Save metadata
    if (window.electronAPI) {
      window.electronAPI.saveMetadata({
        version: '2.0',
        whiteboards: useVaultStore.getState().whiteboards,
        activeWhiteboardId,
      })
    }

    // Clear selection
    window.getSelection()?.removeAllRanges()
    setSelectedText(null)
    setHighlightButtonPosition(null)
  }, [selectedText, activeWhiteboardId, pdfCard, addHighlightCard, selectedColor, updatePdfCard])

  // Delete a highlight and its associated highlight card
  const handleDeleteHighlight = useCallback(async (highlightId: string) => {
    // Find the highlight to get its page number before deleting
    const highlightToDelete = (pdfCard.highlights || []).find(h => h.id === highlightId)
    if (!highlightToDelete) return

    const pageNumber = highlightToDelete.pageNumber

    // Remove the PDF highlight
    const updatedHighlights = (pdfCard.highlights || []).filter(h => h.id !== highlightId)
    updatePdfCard(pdfCard.id, {
      highlights: updatedHighlights,
      modifiedAt: new Date(),
    })

    // Delete the associated highlight card
    deleteHighlightCard(highlightId)

    // Immediately remove the highlight from the DOM
    const highlightLayer = highlightLayerRefs.current.get(pageNumber)
    if (highlightLayer) {
      // Remove all divs with this highlight ID
      const highlightDivs = highlightLayer.querySelectorAll(`[data-highlight-id="${highlightId}"]`)
      highlightDivs.forEach(div => div.remove())
    }

    // Save metadata
    if (window.electronAPI) {
      window.electronAPI.saveMetadata({
        version: '2.0',
        whiteboards: useVaultStore.getState().whiteboards,
        activeWhiteboardId,
      })
    }

    // Close context menu
    setHighlightContextMenu(null)
  }, [pdfCard, updatePdfCard, deleteHighlightCard, activeWhiteboardId])

  // Render highlight overlay on a page
  const renderHighlightOverlay = useCallback((highlight: PdfHighlight) => {
    const highlightLayer = highlightLayerRefs.current.get(highlight.pageNumber)
    if (!highlightLayer) return

    // Create highlight divs for each rect
    highlight.rects.forEach((rect: any) => {
      const highlightDiv = document.createElement('div')
      highlightDiv.className = 'pdf-highlight'
      highlightDiv.style.position = 'absolute'
      highlightDiv.style.left = `${rect.left}px`
      highlightDiv.style.top = `${rect.top}px`
      highlightDiv.style.width = `${rect.width}px`
      highlightDiv.style.height = `${rect.height}px`
      highlightDiv.style.backgroundColor = highlight.color
      highlightDiv.style.opacity = '0.4'
      highlightDiv.style.pointerEvents = 'auto'
      highlightDiv.style.mixBlendMode = 'multiply'
      highlightDiv.style.cursor = 'pointer'
      highlightDiv.style.transition = 'opacity 0.15s ease'
      highlightDiv.dataset.highlightId = highlight.id
      // Allow text selection to work through the highlight
      highlightDiv.style.userSelect = 'none'

      // Add hover effect
      highlightDiv.addEventListener('mouseenter', () => {
        highlightDiv.style.opacity = '0.6'
        highlightDiv.style.cursor = 'pointer'
      })
      highlightDiv.addEventListener('mouseleave', () => {
        highlightDiv.style.opacity = '0.4'
      })

      // Add context menu on right-click
      highlightDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        setHighlightContextMenu({
          x: e.clientX,
          y: e.clientY,
          highlightId: highlight.id,
        })
      })

      // Left-click to show context menu
      highlightDiv.addEventListener('click', (e) => {
        // Only handle direct clicks on the highlight, not text selection drags
        if (window.getSelection()?.toString().length === 0) {
          e.preventDefault()
          setHighlightContextMenu({
            x: e.clientX,
            y: e.clientY,
            highlightId: highlight.id,
          })
        }
      })

      highlightLayer.appendChild(highlightDiv)
    })
  }, [])

  // Render all highlights for a page
  const renderHighlightsForPage = useCallback((pageNumber: number) => {
    const highlightLayer = highlightLayerRefs.current.get(pageNumber)
    if (!highlightLayer || !pdfCard.highlights) return

    // Clear existing highlights
    highlightLayer.innerHTML = ''

    // Render each highlight for this page
    pdfCard.highlights
      .filter(h => h.pageNumber === pageNumber)
      .forEach(highlight => renderHighlightOverlay(highlight))
  }, [pdfCard.highlights, renderHighlightOverlay])

  // Use a portal to render the modal at the root level (document.body)
  // this prevents it from being trapped in stacking contexts of parent components (like transforms)
  return createPortal(
    <div
      className={`pdf-reader-backdrop ${isClosing ? 'closing' : ''}`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
      }}
      onClick={handleClose}
    >
      {/* Main floating container */}
      <div
        className={`pdf-reader-container ${isClosing ? 'closing' : ''}`}
        style={{
          width: '100%',
          maxWidth: '1400px',
          height: '95vh',
          maxHeight: 'calc(100vh - 64px)',
          backgroundColor: '#ffffff',
          borderRadius: '24px',
          boxShadow:
            '0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Elegant header */}
        <div
          style={{
            height: '72px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 32px',
            flexShrink: 0,
            background: 'linear-gradient(to bottom, #ffffff, #fafafa)',
            position: 'relative',
            isolation: 'isolate',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', pointerEvents: 'none' }}>
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              style={{
                background: 'none',
                border: 'none',
                color: '#6b7280',
                cursor: 'pointer',
                padding: '12px',
                minWidth: '44px',
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                transition: 'all 0.2s ease',
                position: 'relative',
                zIndex: 100,
                flexShrink: 0,
                pointerEvents: 'auto',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f3f4f6'
                e.currentTarget.style.color = '#111827'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = '#6b7280'
              }}
              title="Toggle outline"
            >
              <span style={{ pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Menu size={20} />
              </span>
            </button>
            <h2
              style={{
                margin: 0,
                fontSize: '20px',
                fontWeight: '600',
                color: '#111827',
                letterSpacing: '-0.01em',
                pointerEvents: 'none',
              }}
            >
              {pdfCard.title}
            </h2>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              padding: '12px',
              minWidth: '44px',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              transition: 'all 0.2s ease',
              position: 'relative',
              zIndex: 100,
              flexShrink: 0,
              pointerEvents: 'auto',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#fee2e2'
              e.currentTarget.style.color = '#dc2626'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#6b7280'
            }}
            title="Close (Esc)"
          >
            <span style={{ pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={22} />
            </span>
          </button>
        </div>

        {/* Floating Page Number Indicator */}
        {showFloatingPageNumber && (
          <div
            style={{
              position: 'absolute',
              top: '100px',
              right: '48px',
              backgroundColor: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(12px)',
              color: '#374151',
              padding: '12px 20px',
              borderRadius: '12px',
              fontSize: '15px',
              fontWeight: '600',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)',
              zIndex: 1000,
              pointerEvents: 'none',
              transition: 'opacity 0.3s ease, transform 0.3s ease',
              opacity: showFloatingPageNumber ? 1 : 0,
              transform: showFloatingPageNumber ? 'translateY(0)' : 'translateY(-10px)',
            }}
          >
            Page {currentPage} / {pdfCard.pageCount}
          </div>
        )}

        {/* Main content area */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Elegant Sidebar */}
          {showSidebar && (
            <div
              style={{
                width: '300px',
                backgroundColor: '#fafafa',
                borderRight: '1px solid #e5e7eb',
                overflowY: 'auto',
                flexShrink: 0,
              }}
            >
              <div style={{ padding: '24px' }}>
                <h3
                  style={{
                    margin: '0 0 16px 0',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#6b7280',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                  }}
                >
                  Table of Contents
                </h3>
                {outline.length > 0 ? (
                  <OutlineTree items={outline} onItemClick={handleOutlineClick} />
                ) : (
                  <p style={{ color: '#9ca3af', fontSize: '14px', margin: 0 }}>
                    No outline available
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Viewer area with continuous scrolling */}
          <div
            ref={viewerRef}
            style={{
              flex: 1,
              backgroundColor: '#f9fafb',
              overflowY: 'auto',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start',
              padding: '48px 32px',
            }}
          >
            {!pdfDoc ? (
              // Loading skeleton
              <div
                className="pdf-loading-skeleton"
                style={{
                  width: '100%',
                  maxWidth: '800px',
                  height: '1000px',
                  backgroundColor: 'white',
                  boxShadow:
                    '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    border: '3px solid #e5e7eb',
                    borderTopColor: '#3b82f6',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                <div
                  style={{
                    color: '#6b7280',
                    fontSize: '14px',
                    fontWeight: '500',
                  }}
                >
                  Loading PDF...
                </div>
                <style>
                  {`
                    @keyframes spin {
                      to { transform: rotate(360deg); }
                    }
                  `}
                </style>
              </div>
            ) : (
              // Continuous scrolling container with all pages
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '24px',
                  alignItems: 'center',
                  width: '100%',
                }}
              >
                {Array.from({ length: pdfCard.pageCount }, (_, i) => i + 1).map(pageNum => (
                  <div
                    key={pageNum}
                    ref={el => {
                      if (el) pageContainerRefs.current.set(pageNum, el)
                    }}
                    data-page={pageNum}
                    className="pdf-page-fade-in"
                    style={{
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      minHeight: '800px', // Reserve space to prevent layout shift
                    }}
                  >
                    {/* Show loading placeholder for unrendered pages */}
                    {!renderedPages.has(pageNum) && (
                      <div
                        style={{
                          width: '100%',
                          maxWidth: '800px',
                          height: '1000px',
                          backgroundColor: 'white',
                          boxShadow:
                            '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#9ca3af',
                          fontSize: '14px',
                        }}
                      >
                        Loading page {pageNum}...
                      </div>
                    )}

                    {/* Canvas and text layer container - provides positioning context */}
                    <div
                      style={{
                        position: 'relative',
                        display: renderedPages.has(pageNum) ? 'block' : 'none',
                        maxWidth: '100%',
                      }}
                    >
                      <canvas
                        ref={el => {
                          if (el) pageRefs.current.set(pageNum, el)
                        }}
                        style={{
                          backgroundColor: 'white',
                          boxShadow:
                            '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                          display: 'block',
                          maxWidth: '100%',
                          height: 'auto',
                          borderRadius: '4px',
                        }}
                      />

                      {/* Text layer for native text selection - below highlights */}
                      {/* Add 'textLayer debug' class to see text overlay for debugging */}
                      <div
                        ref={el => {
                          if (el) textLayerRefs.current.set(pageNum, el)
                        }}
                        className="textLayer"
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          pointerEvents: 'auto',
                          zIndex: 1,
                          cursor: 'text',
                        }}
                        title={`Page ${pageNum} text layer - Add 'debug' class to visualize`}
                      />

                      {/* Highlight layer - renders above text layer for click handling */}
                      <div
                        ref={el => {
                          if (el) {
                            highlightLayerRefs.current.set(pageNum, el)
                            // Render highlights for this page once the layer is ready
                            if (renderedPages.has(pageNum)) {
                              setTimeout(() => renderHighlightsForPage(pageNum), 0)
                            }
                          }
                        }}
                        className="highlightLayer"
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          width: '100%',
                          height: '100%',
                          pointerEvents: 'none', // Parent doesn't block, children can enable
                          zIndex: 2, // Above text layer
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Floating toolbar */}
        <div
          style={{
            position: 'absolute',
            bottom: '32px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(12px)',
            borderRadius: '16px',
            boxShadow:
              '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05)',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '24px',
          }}
        >
          {/* Navigation controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handlePreviousPage}
              style={{
                background: '#ffffff',
                border: '1px solid #e5e7eb',
                color: '#374151',
                cursor: 'pointer',
                padding: '10px',
                minWidth: '40px',
                minHeight: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                fontSize: '14px',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f3f4f6'
                e.currentTarget.style.borderColor = '#d1d5db'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#ffffff'
                e.currentTarget.style.borderColor = '#e5e7eb'
              }}
              title="Scroll up (↑)"
            >
              <ChevronLeft size={18} />
            </button>
            <div
              style={{
                color: '#374151',
                fontSize: '14px',
                fontWeight: '500',
                padding: '0 12px',
                minWidth: '120px',
                textAlign: 'center',
              }}
            >
              Page {currentPage} / {pdfCard.pageCount}
            </div>
            <button
              onClick={handleNextPage}
              style={{
                background: '#ffffff',
                border: '1px solid #e5e7eb',
                color: '#374151',
                cursor: 'pointer',
                padding: '10px',
                minWidth: '40px',
                minHeight: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                fontSize: '14px',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f3f4f6'
                e.currentTarget.style.borderColor = '#d1d5db'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#ffffff'
                e.currentTarget.style.borderColor = '#e5e7eb'
              }}
              title="Scroll down (↓)"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Divider */}
          <div
            style={{
              width: '1px',
              height: '24px',
              backgroundColor: '#e5e7eb',
            }}
          />

          {/* Zoom controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleZoomOut}
              disabled={scale <= 0.5}
              style={{
                background: scale <= 0.5 ? '#f9fafb' : '#ffffff',
                border: '1px solid #e5e7eb',
                color: scale <= 0.5 ? '#d1d5db' : '#374151',
                cursor: scale <= 0.5 ? 'not-allowed' : 'pointer',
                padding: '10px',
                minWidth: '40px',
                minHeight: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                if (scale > 0.5) {
                  e.currentTarget.style.backgroundColor = '#f3f4f6'
                  e.currentTarget.style.borderColor = '#d1d5db'
                }
              }}
              onMouseLeave={(e) => {
                if (scale > 0.5) {
                  e.currentTarget.style.backgroundColor = '#ffffff'
                  e.currentTarget.style.borderColor = '#e5e7eb'
                }
              }}
              title="Zoom out (-)"
            >
              <ZoomOut size={18} />
            </button>
            <div
              style={{
                color: '#374151',
                fontSize: '14px',
                fontWeight: '500',
                minWidth: '60px',
                textAlign: 'center',
              }}
            >
              {Math.round(scale * 100)}%
            </div>
            <button
              onClick={handleZoomIn}
              disabled={scale >= 3.0}
              style={{
                background: scale >= 3.0 ? '#f9fafb' : '#ffffff',
                border: '1px solid #e5e7eb',
                color: scale >= 3.0 ? '#d1d5db' : '#374151',
                cursor: scale >= 3.0 ? 'not-allowed' : 'pointer',
                padding: '10px',
                minWidth: '40px',
                minHeight: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                if (scale < 3.0) {
                  e.currentTarget.style.backgroundColor = '#f3f4f6'
                  e.currentTarget.style.borderColor = '#d1d5db'
                }
              }}
              onMouseLeave={(e) => {
                if (scale < 3.0) {
                  e.currentTarget.style.backgroundColor = '#ffffff'
                  e.currentTarget.style.borderColor = '#e5e7eb'
                }
              }}
              title="Zoom in (+)"
            >
              <ZoomIn size={18} />
            </button>
          </div>

          {/* Divider */}
          <div
            style={{
              width: '1px',
              height: '24px',
              backgroundColor: '#e5e7eb',
            }}
          />

          {/* Search */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              padding: '8px 12px',
              border: '1px solid #e5e7eb',
            }}
          >
            <Search size={16} color="#9ca3af" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: 'none',
                border: 'none',
                color: '#374151',
                fontSize: '14px',
                width: '160px',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Highlight creation button with color picker - shown when text is selected */}
        {highlightButtonPosition && selectedText && (
          <div
            style={{
              position: 'fixed',
              left: `${highlightButtonPosition.x}px`,
              top: `${highlightButtonPosition.y}px`,
              zIndex: 10001,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {/* Color picker */}
            <div
              style={{
                display: 'flex',
                gap: '6px',
                padding: '8px',
                background: 'white',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
              }}
            >
              {[
                { color: '#fef3c7', name: 'Yellow' },
                { color: '#fecaca', name: 'Red' },
                { color: '#bfdbfe', name: 'Blue' },
                { color: '#bbf7d0', name: 'Green' },
                { color: '#e9d5ff', name: 'Purple' },
                { color: '#fed7aa', name: 'Orange' },
              ].map(({ color, name }) => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  title={name}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    backgroundColor: color,
                    border: selectedColor === color ? '2px solid #374151' : '2px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: selectedColor === color ? '0 0 0 2px white' : 'none',
                  }}
                />
              ))}
            </div>

            {/* Create button */}
            <button
              onClick={handleCreateHighlight}
              style={{
                background: selectedColor,
                border: '1px solid #d1d5db',
                color: '#374151',
                cursor: 'pointer',
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                fontSize: '13px',
                fontWeight: '600',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 6px 10px -1px rgba(0, 0, 0, 0.15), 0 4px 6px -1px rgba(0, 0, 0, 0.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
              }}
              title="Create highlight card"
            >
              <Highlighter size={16} />
              Create Highlight Card
            </button>
          </div>
        )}

        {/* Highlight context menu - shown when right-clicking a highlight */}
        {highlightContextMenu && (
          <div
            data-context-menu="highlight"
            style={{
              position: 'fixed',
              left: `${highlightContextMenu.x}px`,
              top: `${highlightContextMenu.y}px`,
              zIndex: 10002,
              background: 'white',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)',
              padding: '4px',
              minWidth: '160px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => handleDeleteHighlight(highlightContextMenu.highlightId)}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                color: '#dc2626',
                cursor: 'pointer',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                textAlign: 'left',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#fee2e2'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
              Delete Highlight
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// Outline tree component
interface OutlineTreeProps {
  items: OutlineItem[]
  onItemClick: (pageNumber: number) => void
  level?: number
}

function OutlineTree({ items, onItemClick, level = 0 }: OutlineTreeProps) {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set())

  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expandedItems)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedItems(newExpanded)
  }

  return (
    <div>
      {items.map((item, index) => (
        <div key={index}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              paddingLeft: `${level * 16}px`,
              cursor: 'pointer',
              padding: '8px 10px',
              borderRadius: '8px',
              marginBottom: '2px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f3f4f6'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            {item.items && item.items.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpand(index)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6b7280',
                  cursor: 'pointer',
                  padding: '4px',
                  minWidth: '24px',
                  minHeight: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#374151'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#6b7280'
                }}
              >
                {expandedItems.has(index) ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronRightIcon size={16} />
                )}
              </button>
            )}
            {(!item.items || item.items.length === 0) && (
              <div style={{ width: '16px' }} />
            )}
            <div
              onClick={() => {
                if (item.pageNumber) {
                  onItemClick(item.pageNumber)
                }
              }}
              style={{
                flex: 1,
                color: '#374151',
                fontSize: '14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontWeight: '400',
              }}
            >
              <span>{item.title}</span>
              {item.pageNumber && (
                <span
                  style={{
                    color: '#9ca3af',
                    fontSize: '12px',
                    fontWeight: '500',
                  }}
                >
                  {item.pageNumber}
                </span>
              )}
            </div>
          </div>
          {item.items && expandedItems.has(index) && (
            <OutlineTree
              items={item.items}
              onItemClick={onItemClick}
              level={level + 1}
            />
          )}
        </div>
      ))}
    </div>
  )
}
