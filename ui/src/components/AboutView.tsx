import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Plus } from 'lucide-react'
import { fetchCoverage } from '../lib/api'
import { useLatestBatch } from '../hooks/useLatestBatch'
import { useTagCatalog } from '../hooks/useTagCatalog'
import { NEW_GRAPH_STATE } from '../hooks/useNewGraphRequest'

const REPO_URL = 'https://github.com/ai-safety-graph/alignment-graph'
const ISSUES_URL = `${REPO_URL}/issues`

// `date` is a plain YYYY-MM-DD; build it as a local date so it isn't
// shifted a day back in timezones west of UTC.
function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function ExternalLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      target='_blank'
      rel='noreferrer'
      className='text-[#4ea8de] hover:underline'
    >
      {children}
    </a>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className='flex flex-col gap-3'>
      <h2 className='text-lg font-semibold text-white'>{title}</h2>
      <div className='flex flex-col gap-3 text-[15px] leading-relaxed text-neutral-300'>
        {children}
      </div>
    </section>
  )
}

// Reference material closed by default, so the page doesn't read as a wall
// of text; the summary is styled like a Section heading
function CollapsibleSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <details className='group flex flex-col gap-3'>
      <summary className='cursor-pointer list-none flex items-center gap-2 text-lg font-semibold text-white [&::-webkit-details-marker]:hidden'>
        <h2>{title}</h2>
        <ChevronRight
          size={16}
          className='text-neutral-500 transition-transform group-open:rotate-90'
        />
      </summary>
      <div className='flex flex-col gap-3 text-[15px] leading-relaxed text-neutral-300'>
        {children}
      </div>
    </details>
  )
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className='text-xs font-medium uppercase tracking-wide text-neutral-500'>
      {children}
    </h3>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className='px-1.5 py-0.5 rounded border border-neutral-700 bg-neutral-900 text-[12px] text-neutral-200'>
      {children}
    </kbd>
  )
}

function CoverageLine() {
  const { data: coverage } = useQuery({
    queryKey: ['coverage'],
    queryFn: fetchCoverage,
  })
  const batch = useLatestBatch()
  if (!coverage?.earliest) return null

  return (
    <p className='text-sm text-neutral-400'>
      The collection holds {coverage.total.toLocaleString()} papers published
      from {formatDate(coverage.earliest)} onwards.
      {batch && (
        <>
          {' '}
          Last updated {formatDate(batch.date)}, with{' '}
          {batch.added.toLocaleString()} new{' '}
          {batch.added === 1 ? 'paper' : 'papers'}.
        </>
      )}
    </p>
  )
}

function TagGlossary() {
  const { tags, isLoading } = useTagCatalog()
  const entries = Object.entries(tags).sort((a, b) => b[1].size - a[1].size)

  if (isLoading) return <p className='text-neutral-500'>Loading tags…</p>
  if (entries.length === 0) return null

  return (
    <dl className='flex flex-col gap-4'>
      {entries.map(([tag, { size, description }]) => (
        <div key={tag} className='flex flex-col gap-1'>
          <dt className='flex items-baseline gap-2'>
            <span className='inline-block text-white first-letter:uppercase'>
              {tag}
            </span>
            <span className='text-xs text-neutral-500'>
              {size.toLocaleString()} papers
            </span>
          </dt>
          {description && (
            <dd className='text-sm text-neutral-400'>
              {description.replaceAll(' -- ', ' — ')}
            </dd>
          )}
        </div>
      ))}
    </dl>
  )
}

export default function AboutView() {
  return (
    <div className='min-h-dvh md:fixed md:inset-0 bg-neutral-950 text-[#e5e5e5] flex flex-col'>
      <div className='sticky top-0 z-10 shrink-0 bg-neutral-950/90 backdrop-blur px-4 py-3 flex items-center justify-between gap-3'>
        {/* Logo → home at the left, as in the app's other headers */}
        <Link to='/' aria-label='Alignment Graph home' className='shrink-0'>
          <img
            src='/ag-logo.svg'
            alt='Alignment Graph'
            className='h-[30px] w-auto opacity-60 saturate-70 hover:opacity-90 transition-opacity'
          />
        </Link>
        <h1 className='sr-only'>About</h1>
        {/* Lands on the home view with the new-graph modal open */}
        <Link
          to='/'
          state={NEW_GRAPH_STATE}
          className='shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-950 border border-neutral-700 text-[13px] text-neutral-300 hover:text-white hover:border-neutral-500 whitespace-nowrap transition-colors'
        >
          <Plus size={14} />
          Create a graph
        </Link>
      </div>

      <div className='flex-1 md:overflow-y-auto scrollbar scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent'>
        <div className='max-w-3xl mx-auto px-4 py-8 md:py-12 flex flex-col gap-10'>
          <div className='flex flex-col gap-3'>
            <p className='text-[15px] leading-relaxed text-neutral-300'>
              Alignment Graph is a map of AI safety and alignment research on
              arXiv. New papers are collected every day, sorted by topic, and
              laid out so related work sits close together.
            </p>
            <CoverageLine />
          </div>

          <Section title='How to use'>
            <SubHeading>Quick start</SubHeading>
            <ol className='list-decimal pl-5 flex flex-col gap-2'>
              <li>
                <span className='text-white'>Pick a topic.</span> Click{' '}
                <span className='text-white'>New graph</span> and choose topic
                tags, research domains and a date range. Turn on{' '}
                <span className='text-white'>Peer-reviewed only</span> to keep
                only accepted papers.
              </li>
              <li>
                <span className='text-white'>Explore.</span> Each dot is a
                paper, and papers on similar topics sit close together. Click
                one to see its summary and related papers.
              </li>
              <li>
                <span className='text-white'>Keep what's useful.</span> Save the
                graph, then <span className='text-white'>Pin</span> papers to it
                from their details.
              </li>
            </ol>

            <SubHeading>Views</SubHeading>
            <ul className='list-disc pl-5 flex flex-col gap-2'>
              <li>
                <span className='text-white'>Graph</span> (desktop): the map.
                The legend in the corner explains the colours. Press{' '}
                <Kbd>/</Kbd> or <Kbd>⌘/Ctrl</Kbd>+<Kbd>K</Kbd> to search and{' '}
                <Kbd>Esc</Kbd> to clear.
              </li>
              <li>
                <span className='text-white'>List</span>: the same papers in a
                searchable list. When a saved graph is selected, tabs switch
                between its <span className='text-white'>Matches</span>, your{' '}
                <span className='text-white'>Pinned</span> papers, and{' '}
                <span className='text-white'>All papers</span> to pin from.
              </li>
              <li>
                <span className='text-white'>On a phone</span>: the list is the
                main view. Tap a paper for its summary, tap a related paper to
                follow it, and step back along the trail.
              </li>
            </ul>

            <p className='text-sm text-neutral-400'>
              You can keep up to 50 graphs, with up to 500 pinned papers each,
              and edit a graph's filters at any time. Graphs are stored only in
              this browser: they don't sync, there's no export yet, and clearing
              this site's data deletes them.
            </p>
          </Section>

          <Section title='Reading the map'>
            <ul className='list-disc pl-5 flex flex-col gap-2'>
              <li>Only closeness matters; the axes mean nothing.</li>
              <li>
                A dense cluster means many papers, not more important ones.
              </li>
              <li>
                Positions are approximate; a paper's related-papers list is more
                reliable.
              </li>
              <li>
                New papers are slotted in daily and placed precisely at the next
                refit.
              </li>
            </ul>
          </Section>

          <Section title='Topic tags'>
            <p>
              Each paper gets one or more of these tags, chosen by the
              classification step below. The first tag is the paper's main
              topic. Counts are the number of papers carrying each tag.
            </p>
            <TagGlossary />
          </Section>

          <CollapsibleSection title='How papers are collected'>
            <ol className='list-decimal pl-5 flex flex-col gap-2'>
              <li>
                <span className='text-white'>Harvest.</span> Each day, new
                papers are fetched from arXiv's public OAI-PMH feed for the
                Computer Science, Statistics, Economics and Systems & Control
                categories.
              </li>
              <li>
                <span className='text-white'>Keyword screen.</span> Titles and
                abstracts are checked against a list of alignment, safety,
                interpretability and governance terms.
              </li>
              <li>
                <span className='text-white'>Similarity screen.</span> Papers
                are embedded with SPECTER2 and compared against a hand-picked
                set of seed papers.
              </li>
              <li>
                <span className='text-white'>LLM classification.</span> A
                language model reads each remaining candidate, decides whether
                it is relevant, and assigns the topic tags you see in the app.
              </li>
              <li>
                <span className='text-white'>Layout.</span> Relevant papers are
                embedded by topic and projected into 2D with UMAP. New papers
                are placed next to their nearest neighbours without moving
                existing ones, and the whole layout is refit periodically.
              </li>
            </ol>
            <p>
              All of this is automated, so the collection may miss some papers
              or include borderline ones.
            </p>
          </CollapsibleSection>

          <CollapsibleSection title='Privacy'>
            <ul className='list-disc pl-5 flex flex-col gap-2'>
              <li>No accounts, cookies or advertising trackers.</li>
              <li>
                We use{' '}
                <ExternalLink href='https://umami.is'>Umami</ExternalLink>, a
                cookieless analytics tool, to count page views and a few
                anonymous interactions (such as opening a paper or changing a
                filter). It doesn't identify you or follow you across sites.
              </li>
              <li>
                Saved graphs are stored only in your browser's local storage and
                are never sent to our server. Clearing this site's data deletes
                them.
              </li>
              <li>
                Searches, filters and paper lookups are sent to our API to fetch
                results. They are not tied to any identity, but our hosting
                providers may keep standard request logs such as IP address and
                URL. We keep anonymous search terms and result counts, without
                IP addresses, to learn what people look for.
              </li>
              <li>
                Paper titles, authors and abstracts come from public arXiv
                metadata.
              </li>
            </ul>
          </CollapsibleSection>

          <Section title='Feedback'>
            <p>
              Spotted a missing paper, a wrong tag, or a bug? Please{' '}
              <ExternalLink href={ISSUES_URL}>
                open an issue on GitHub
              </ExternalLink>
              . The source code is in the{' '}
              <ExternalLink href={REPO_URL}>same repository</ExternalLink>.
            </p>
          </Section>

          <p className='pt-6 border-t border-neutral-800 text-xs text-neutral-500'>
            Thank you to arXiv for use of its open access interoperability.
            Paper metadata comes from{' '}
            <ExternalLink href='https://arxiv.org'>arXiv</ExternalLink>, and
            each paper links back to its arXiv page.
          </p>
        </div>
      </div>
    </div>
  )
}
