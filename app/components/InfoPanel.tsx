import { ExternalLink } from 'lucide-react';

import type { Entity } from '@/app/lib/subject-data.ts';

type InfoPanelProps = {
  entity: Entity;
};

/**
 * The reading column: summary, spec table, notes, citations.
 *
 * Carries no 'use client' directive and no interactivity of its own, though it is
 * bundled for the client because the shell that renders it is a client component.
 * Figures use the mono face because the whole panel is meant to read as a spec sheet.
 */
export default function InfoPanel({ entity }: InfoPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-xl text-graphite">{entity.formalName}</h2>
        <p className="max-w-prose text-sm leading-relaxed text-graphite">{entity.summary}</p>
      </div>

      <section aria-labelledby={`${entity.id}-facts`}>
        <h3
          id={`${entity.id}-facts`}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-drafting"
        >
          Specification
        </h3>
        <dl className="mt-2">
          {entity.facts.map((fact) => (
            <div
              key={fact.label}
              className="flex flex-col gap-0.5 border-b border-trace py-2 sm:flex-row sm:gap-4"
            >
              <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-drafting sm:w-40 sm:shrink-0">
                {fact.label}
              </dt>
              <dd className="font-mono text-[12px] leading-5 text-graphite">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {entity.notes.length > 0 ? (
        <section aria-labelledby={`${entity.id}-notes`}>
          <h3
            id={`${entity.id}-notes`}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-drafting"
          >
            Notes
          </h3>
          <ul className="mt-2 flex flex-col gap-2.5">
            {entity.notes.map((note) => (
              <li key={note} className="max-w-prose text-sm leading-relaxed text-graphite">
                {note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby={`${entity.id}-sources`}>
        <h3
          id={`${entity.id}-sources`}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-drafting"
        >
          Sources
        </h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {entity.sources.map((source) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-baseline gap-1.5 text-[12px] leading-5 text-graphite underline decoration-trace underline-offset-2 hover:decoration-current"
              >
                {source.title}
                <ExternalLink size={11} aria-hidden="true" className="shrink-0 self-center" />
              </a>
              <span className="ml-2 font-mono text-[10px] text-drafting">
                retrieved {source.retrieved}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
