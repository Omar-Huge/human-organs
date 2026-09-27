'use client';

import { Search } from 'lucide-react';

import { matchesQuery } from '@/app/lib/search.ts';
import { ENTITIES } from '@/app/lib/subject-data.ts';
import type { EntityId } from '@/app/lib/subject-data.ts';

type EntityLibraryProps = {
  selectedId: EntityId;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (id: EntityId) => void;
  onPrefetch: (model: string) => void;
};

export default function EntityLibrary({
  selectedId,
  query,
  onQueryChange,
  onSelect,
  onPrefetch,
}: EntityLibraryProps) {
  const visible = ENTITIES.filter((entity) => matchesQuery(entity, query));

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          size={13}
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-drafting"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search organs"
          aria-label="Search organs"
          className="w-full border border-trace bg-transparent py-2 pl-8 pr-2.5 font-mono text-[11px] text-graphite placeholder:text-drafting"
        />
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-drafting" role="status">
        {visible.length} of {ENTITIES.length} shown
      </p>

      {visible.length === 0 ? (
        <p className="py-2 text-sm text-drafting">
          Nothing matches “{query.trim()}”. Try an organ, a body system, or a part.
        </p>
      ) : (
        <ol className="flex flex-col">
          {visible.map((entity) => {
            const isActive = entity.id === selectedId;
            const index = ENTITIES.indexOf(entity) + 1;

            return (
              <li key={entity.id}>
                <button
                  type="button"
                  onClick={() => onSelect(entity.id)}
                  onPointerEnter={() => onPrefetch(entity.model)}
                  onFocus={() => onPrefetch(entity.model)}
                  aria-current={isActive ? 'true' : undefined}
                  className="flex w-full items-start gap-3 border-b border-trace py-2.5 text-left hover:bg-trace/45"
                >
                  <span
                    aria-hidden="true"
                    className="mt-[3px] h-3 w-[3px] shrink-0"
                    style={{ background: isActive ? entity.accent : 'transparent' }}
                  />
                  <span className="font-mono text-[10px] leading-5 text-drafting">
                    {String(index).padStart(2, '0')}
                  </span>
                  <span className="flex flex-col">
                    <span
                      className="text-sm leading-5"
                      style={{ color: isActive ? entity.accent : undefined }}
                    >
                      {entity.name}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-drafting">
                      {entity.category}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
