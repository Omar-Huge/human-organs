'use client';

import { useEffect, useRef, useState } from 'react';
import { Info, PanelLeft, X } from 'lucide-react';

import EntityLibrary from './EntityLibrary.tsx';
import InfoPanel from './InfoPanel.tsx';
import Modal from './Modal.tsx';
import SubjectViewer from './SubjectViewer.tsx';
import type { SubjectViewerHandle } from './SubjectViewer.tsx';
import { DEFAULT_ENTITY_ID, ENTITIES, getEntity } from '@/app/lib/subject-data.ts';
import type { EntityId } from '@/app/lib/subject-data.ts';

/**
 * Application shell.
 *
 * Owns the three pieces of state the whole interface reads from — which organ is
 * selected, what is typed in the search box, and whether the mobile drawer is open —
 * and nothing else. Hotspot selection deliberately lives inside SubjectViewer, since
 * the canvas and the text list are the only things that care about it.
 */
export default function ExplorerApp() {
  const [selectedId, setSelectedId] = useState<EntityId>(DEFAULT_ENTITY_ID);
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const viewerRef = useRef<SubjectViewerHandle>(null);
  const entity = getEntity(selectedId);

  /**
   * Prefetch on intent. Hovering or focusing a row is a strong signal the model is
   * about to be needed, and fetching then usually means the switch completes with no
   * visible loading state at all.
   */
  const warm = (model: string) => viewerRef.current?.prefetch(model);

  const choose = (id: EntityId) => {
    setSelectedId(id);
    // On mobile the library is a drawer over the viewer, so choosing has to dismiss it
    // or the result of the choice is hidden behind the thing that made it.
    setDrawerOpen(false);
  };

  // The drawer is a temporary overlay, so Escape must close it — the same contract as
  // the dialog, and the one keyboard users will reach for first.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-6 md:py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-xl text-graphite md:text-2xl">Soft Machinery</h1>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-drafting">
            The organs that keep you running
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="tool-button md:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
          >
            <PanelLeft size={14} aria-hidden="true" />
            Library
          </button>
          <button type="button" className="tool-button" onClick={() => setAboutOpen(true)}>
            <Info size={14} aria-hidden="true" />
            About
          </button>
        </div>
      </header>

      <div className="grid flex-1 gap-7 md:grid-cols-[220px_minmax(0,1fr)] md:gap-8">
        {/* Desktop library. Hidden rather than unmounted on mobile so the drawer copy
            is the only instance in the accessibility tree at small sizes. */}
        <aside className="hidden md:block">
          <nav aria-label="Organ library">
            <EntityLibrary
              selectedId={selectedId}
              query={query}
              onQueryChange={setQuery}
              onSelect={choose}
              onPrefetch={warm}
            />
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col gap-8">
          <SubjectViewer ref={viewerRef} entity={entity} />
          <InfoPanel entity={entity} />
        </div>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <button
            type="button"
            aria-label="Close library"
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-graphite/45"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative flex h-full w-[84%] max-w-xs flex-col overflow-y-auto border-r border-trace bg-paper p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.12em] text-drafting">
                Organs
              </h2>
              <button
                type="button"
                className="tool-button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close library"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Organ library">
              <EntityLibrary
                selectedId={selectedId}
                query={query}
                onQueryChange={setQuery}
                onSelect={choose}
                onPrefetch={warm}
              />
            </nav>
          </div>
        </div>
      ) : null}

      <Modal open={aboutOpen} title="About Soft Machinery" onClose={() => setAboutOpen(false)}>
        <div className="flex flex-col gap-4 text-sm leading-relaxed text-graphite">
          <p>
            An interactive explorer for {ENTITIES.length} human organs. Pick one and the viewer
            shows what it does, and which part of it does the work.
          </p>

          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-drafting">
              Models
            </h3>
            <p className="mt-1.5">
              Every model is built from{' '}
              <a
                className="underline decoration-trace underline-offset-2 hover:decoration-graphite"
                href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html"
                target="_blank"
                rel="noreferrer"
              >
                BodyParts3D
              </a>
              , © The Database Center for Life Science, licensed under CC Attribution 4.0
              International. The meshes have been simplified and coloured for this project; full
              attribution is recorded in CREDITS.md in the repository.
            </p>
          </div>

          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-drafting">
              Accuracy
            </h3>
            <p className="mt-1.5">
              The atlas models one reference adult, and real organs vary from person to person.
              Colours are illustrative, chosen to read as living tissue rather than measured.
              The atlas has no outer surface for the lungs, only their airways and vessels, so
              the translucent lobe surfaces are generated around those trees: an approximation
              of each lobe&apos;s shape, not a measured one.
              Every figure is transcribed from the source cited beneath it, with the date it was
              retrieved. Where a source did not state a number, the fact was left out rather than
              filled in from memory.
            </p>
          </div>

          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-drafting">
              Hotspot positions
            </h3>
            <p className="mt-1.5">
              Markers sit at the measured centre of the structure they name, taken from the
              atlas geometry. Skin has no sub-structures to measure, so its markers are placed
              by hand.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
