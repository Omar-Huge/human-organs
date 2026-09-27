'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Focus, RotateCcw, Scissors, X, ZoomIn, ZoomOut } from 'lucide-react';

import { Viewer } from '@/app/lib/three/viewer.ts';
import type { ViewerStatus } from '@/app/lib/three/viewer.ts';
import type { Projection } from '@/app/lib/three/hotspots.ts';
import type { Entity } from '@/app/lib/subject-data.ts';

export type SubjectViewerHandle = {
  /** Warms the cache for a model the user has signalled interest in. */
  prefetch: (url: string) => void;
};

type SubjectViewerProps = {
  entity: Entity;
  ref?: Ref<SubjectViewerHandle>;
};

const STATUS_LABEL: Record<ViewerStatus, string> = {
  idle: 'Standby',
  loading: 'Loading model',
  ready: 'Ready',
  error: 'Load failed',
};

/** Gap between the callout card and the aperture edge. */
const CARD_INSET = 12;
const CARD_WIDTH = 210;

export default function SubjectViewer({ entity, ref }: SubjectViewerProps) {
  /**
   * Dedicated mount point. React renders this element empty and never puts children
   * in it, so the canvas the Viewer appends can never collide with reconciliation.
   */
  const hostRef = useRef<HTMLDivElement>(null);
  const apertureRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const lineRef = useRef<SVGPolylineElement>(null);
  const anchorRef = useRef<SVGCircleElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<ViewerStatus>('idle');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sectioning, setSectioning] = useState(false);
  const [sectionAt, setSectionAt] = useState(0.5);
  const [isolating, setIsolating] = useState(false);

  const selected = entity.hotspots.find((hotspot) => hotspot.id === selectedId) ?? null;

  useImperativeHandle(
    ref,
    () => ({ prefetch: (url: string) => viewerRef.current?.prefetch(url) }),
    [],
  );

  /**
   * Positions the leader line and card from the marker's screen coordinates.
   *
   * Written straight to the DOM rather than through state: this fires on every
   * rendered frame while the camera moves, and re-rendering the React tree at frame
   * rate to move two elements would be indefensible.
   */
  const applyProjection = useCallback((projection: Projection | null) => {
    const line = lineRef.current;
    const card = cardRef.current;
    const anchor = anchorRef.current;
    const aperture = apertureRef.current;
    if (!line || !card || !anchor || !aperture) return;

    if (!projection || !projection.visible) {
      line.style.visibility = 'hidden';
      anchor.style.visibility = 'hidden';
      card.style.visibility = 'hidden';
      return;
    }

    const width = aperture.clientWidth;
    const height = aperture.clientHeight;
    const cardHeight = card.offsetHeight || 74;

    // The card lives against whichever edge the marker is furthest from, so the leader
    // line crosses open space instead of doubling back over the hardware it points at.
    const onLeft = projection.x > width / 2;
    const cardX = onLeft ? CARD_INSET : width - CARD_INSET - CARD_WIDTH;
    const cardY = Math.min(Math.max(projection.y - cardHeight / 2, CARD_INSET), Math.max(CARD_INSET, height - CARD_INSET - cardHeight));

    const attachX = onLeft ? cardX + CARD_WIDTH : cardX;
    const attachY = cardY + cardHeight / 2;
    const elbowX = onLeft ? attachX + 20 : attachX - 20;

    line.setAttribute(
      'points',
      `${projection.x},${projection.y} ${elbowX},${projection.y} ${elbowX},${attachY} ${attachX},${attachY}`,
    );
    anchor.setAttribute('cx', String(projection.x));
    anchor.setAttribute('cy', String(projection.y));

    card.style.left = `${cardX}px`;
    card.style.top = `${cardY}px`;

    line.style.visibility = 'visible';
    anchor.style.visibility = 'visible';
    card.style.visibility = 'visible';
  }, []);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const viewer = new Viewer({
      container,
      reducedMotion,
      onStatusChange: (next, detail) => {
        setStatus(next);
        setErrorDetail(next === 'error' ? (detail ?? 'Unknown error') : null);
      },
      onHotspotSelect: setSelectedId,
      onHotspotProject: applyProjection,
    });
    viewerRef.current = viewer;

    /**
     * Test hook.
     *
     * The GPU-level guarantees this project makes — that the render loop idles at zero
     * draws, and that teardown returns renderer.info.memory to baseline — are only
     * observable from inside the Viewer, and only in a real browser. This is the seam
     * the Playwright suite reads. It is removed on teardown, and nothing in the
     * application reads it.
     */
    (window as Window & { __cruisePhase?: { viewer: Viewer } }).__cruisePhase = { viewer };

    return () => {
      viewerRef.current = null;
      delete (window as Window & { __cruisePhase?: { viewer: Viewer } }).__cruisePhase;
      // Strict Mode runs this immediately after the first mount in development. If
      // teardown were incomplete the second mount would inherit a leaked GL context,
      // so this path is exercised on every dev page load by design.
      viewer.dispose();
    };
  }, [applyProjection]);

  // Model and markers are keyed together, and separately from viewer construction, so
  // switching entities cross-fades inside the existing scene instead of rebuilding it.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.setHotspots(entity.id, entity.hotspots);
    void viewer.showModel(entity.model);
    setIsolating(false);
  }, [entity.id, entity.model, entity.hotspots]);

  // Isolation follows the selection: picking another part while isolated shows that
  // part instead, and clearing the selection brings the whole organ back.
  useEffect(() => {
    if (!isolating) return;
    if (!selectedId || !viewerRef.current?.isolate(selectedId)) {
      viewerRef.current?.isolate(null);
      setIsolating(false);
    }
  }, [isolating, selectedId]);

  // Only derived hotspots own geometry; skin's hand-placed ones have nothing to isolate.
  const canIsolate = selected?.kind === 'derived';

  return (
    <section
      className="flex flex-col"
      aria-label={`3D viewer: ${entity.name}`}
      style={{ ['--accent' as string]: entity.accent }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selectedId) {
          viewerRef.current?.selectHotspot(null);
        }
      }}
    >
      <div
        ref={apertureRef}
        className="aperture relative aspect-[4/3] w-full md:aspect-[16/10]"
      >
        {/* The canvas is created and removed by the Viewer, not rendered here — see
            the ViewerOptions.container comment for why its lifetime must match the GL
            context rather than React's. */}
        <div ref={hostRef} className="absolute inset-0" />

        {/* Keyed on the selection so the draw-on animation replays for each hotspot
            rather than only the first. */}
        <div key={selectedId ?? 'none'} aria-hidden="true">
          <svg className="callout-layer">
            <polyline ref={lineRef} className="callout-line" style={{ visibility: 'hidden' }} />
            <circle ref={anchorRef} className="callout-anchor" r="2.5" style={{ visibility: 'hidden' }} />
          </svg>

          <div ref={cardRef} className="callout-card" style={{ visibility: 'hidden' }}>
            {selected ? (
              <>
                <p className="callout-label">Callout</p>
                <p className="callout-title">{selected.label}</p>
                <p className="callout-detail">{selected.detail}</p>
              </>
            ) : null}
          </div>
        </div>

        <p className="viewer-status" role="status">
          {STATUS_LABEL[status]}
          {status === 'error' && errorDetail ? ` — ${errorDetail}` : ''}
        </p>
      </div>

      <div className="tool-rail flex-wrap">
        <button
          type="button"
          className="tool-button"
          onClick={() => viewerRef.current?.resetView()}
          disabled={status !== 'ready'}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Reset view
        </button>

        {/* Zoom exists as buttons because scroll-to-zoom is unreachable by keyboard. */}
        <button
          type="button"
          className="tool-button"
          onClick={() => viewerRef.current?.zoomBy(0.8)}
          disabled={status !== 'ready'}
          aria-label="Zoom in"
        >
          <ZoomIn size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="tool-button"
          onClick={() => viewerRef.current?.zoomBy(1.25)}
          disabled={status !== 'ready'}
          aria-label="Zoom out"
        >
          <ZoomOut size={14} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="tool-button"
          aria-pressed={sectioning}
          disabled={status !== 'ready'}
          onClick={() => {
            const next = !sectioning;
            setSectioning(next);
            viewerRef.current?.setCrossSection(next, sectionAt);
          }}
          style={sectioning ? { background: 'var(--trace)' } : undefined}
        >
          <Scissors size={14} aria-hidden="true" />
          Cross-section
        </button>

        {/* The slider only exists while the section is on — an inert control would be
            exactly the dead UI this project forbids. */}
        {sectioning ? (
          <label className="flex items-center gap-2 pl-1 font-mono text-[10px] uppercase tracking-[0.08em] text-drafting">
            Cut
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={sectionAt}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSectionAt(next);
                viewerRef.current?.setCrossSection(true, next);
              }}
              className="w-28 accent-[var(--accent)]"
              aria-label="Cross-section position"
            />
          </label>
        ) : null}

        {canIsolate ? (
          <button
            type="button"
            className="tool-button"
            aria-pressed={isolating}
            disabled={status !== 'ready'}
            onClick={() => {
              const next = !isolating;
              if (!next) viewerRef.current?.isolate(null);
              setIsolating(next);
            }}
            style={isolating ? { background: 'var(--trace)' } : undefined}
          >
            <Focus size={14} aria-hidden="true" />
            Isolate
          </button>
        ) : null}

        {selectedId ? (
          <button
            type="button"
            className="tool-button"
            onClick={() => viewerRef.current?.selectHotspot(null)}
          >
            <X size={14} aria-hidden="true" />
            Clear callout
          </button>
        ) : null}
      </div>

      {/*
        Text equivalent for the canvas, which is opaque to assistive technology by
        definition. These are the same controls the markers are — selecting here drives
        exactly the same viewer state — so the keyboard path is the feature, not a
        parallel description of it.
      */}
      <div className="mt-5">
        {/* An h2, not an h3: this is a top-level section of the page alongside the
            info panel, and it precedes that panel in the DOM. Marking it h3 skipped a
            level, which is a real navigation problem for screen reader users. Its
            small size is a visual choice, not a structural one. */}
        <h2
          id={`${entity.id}-hotspots`}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-drafting"
        >
          Hotspots — {entity.name}
        </h2>
        <ul aria-labelledby={`${entity.id}-hotspots`} className="mt-2 flex flex-col">
          {entity.hotspots.map((hotspot) => {
            const isSelected = hotspot.id === selectedId;
            return (
              <li key={hotspot.id}>
                <button
                  type="button"
                  onClick={() => viewerRef.current?.selectHotspot(isSelected ? null : hotspot.id)}
                  aria-pressed={isSelected}
                  className="flex w-full items-baseline gap-2.5 border-b border-trace py-2 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: isSelected ? hotspot.color : 'var(--trace)' }}
                  />
                  <span
                    className="text-sm"
                    style={{ color: isSelected ? hotspot.color : undefined }}
                  >
                    {hotspot.label}
                  </span>
                  <span className="text-xs text-drafting">{hotspot.detail}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
