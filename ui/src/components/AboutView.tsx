import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { fetchCoverage } from '../lib/api'
import { useLatestBatch } from '../hooks/useLatestBatch'
import { useTagCatalog } from '../hooks/useTagCatalog'

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
    <div className='fixed inset-0 bg-neutral-950 text-[#e5e5e5] flex flex-col'>
      <div className='shrink-0 bg-neutral-950/90 backdrop-blur px-4 py-3 flex items-center justify-between gap-3'>
        <Link
          to='/'
          aria-label='Back'
          className='shrink-0 p-1 cursor-pointer text-neutral-300 hover:text-white transition-colors'
        >
          <ArrowLeft size={15} />
        </Link>
        <h1 className='sr-only'>About</h1>
        <a target='_blank' href={REPO_URL}>
          <img
            src='/ag-logo.svg'
            alt='Alignment Graph Logo'
            className='h-[34px] w-auto opacity-50 saturate-70'
          />
        </a>
      </div>

      <div className='flex-1 overflow-y-auto scrollbar scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent'>
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
            <p>
              <span className='text-white'>Graph view</span> (desktop): each dot
              is a paper, and papers on similar topics are placed near each
              other. Click a paper to open its details, summary and related
              papers. Press <Kbd>/</Kbd> or <Kbd>⌘/Ctrl</Kbd>+<Kbd>K</Kbd> to
              search and <Kbd>Esc</Kbd> to clear the search.
            </p>
            <p>
              <span className='text-white'>Filters</span>: narrow the papers by
              topic tag, research domain or publication date.
            </p>
            <p>
              <span className='text-white'>List view</span>: the library button
              in the graph view opens a searchable list of papers, with the
              selected paper's details beside it.
            </p>
            <p>
              <span className='text-white'>On mobile</span>: the list view is
              the main view. Search at the top, tap a paper to open its summary
              and related papers, and tap a related paper to follow it. The
              trail of papers you've opened lets you step back. Filters and
              saved graphs work the same way as on desktop.
            </p>
            <p>
              <span className='text-white'>Saved graphs</span>: use{' '}
              <span className='text-white'>New Graph</span> to start a named
              collection, then add papers to it from their detail panel. Pick a
              saved graph from the dropdown to see only those papers. You can
              keep up to 50 graphs of up to 500 papers each.
            </p>
            <p className='text-sm text-neutral-400'>
              Saved graphs live only in this browser. They don't sync to your
              other devices or browsers, there's no export yet, and clearing
              this site's data deletes them.
            </p>
          </Section>

          <Section title='Reading the map'>
            <ul className='list-disc pl-5 flex flex-col gap-2'>
              <li>
                Only closeness matters. The axes have no meaning, so "left" or
                "up" says nothing about a paper.
              </li>
              <li>
                A dense cluster means many papers on a topic, not that the topic
                or its papers are more important.
              </li>
              <li>
                Positions are approximate. A 2D map can't keep every similarity,
                so two nearby papers may only be loosely related. The
                related-papers list in each paper's details is a more reliable
                guide.
              </li>
              <li>
                Existing papers don't move between daily updates. New papers are
                slotted in next to their closest neighbours, which is less
                precise than a full re-layout, so recent papers' positions are
                rougher until the next periodic refit.
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

          <Section title='How papers are collected'>
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
          </Section>

          <Section title='Privacy'>
            <ul className='list-disc pl-5 flex flex-col gap-2'>
              <li>No accounts, cookies, analytics or third-party trackers.</li>
              <li>
                Saved graphs are stored only in your browser's local storage and
                are never sent to our server. Clearing this site's data deletes
                them.
              </li>
              <li>
                Searches, filters and paper lookups are sent to our API to fetch
                results. They are not tied to any identity, but our hosting
                providers may keep standard request logs such as IP address and
                URL.
              </li>
              <li>
                Paper titles, authors and abstracts come from public arXiv
                metadata.
              </li>
            </ul>
          </Section>

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
