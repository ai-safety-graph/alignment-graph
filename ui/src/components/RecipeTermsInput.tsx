import { useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, User, X } from 'lucide-react'

import { fetchAuthors } from '../lib/api'
import {
  keywordLabel,
  MAX_TERM_LENGTH,
  MAX_TERMS,
  MIN_TERM_LENGTH,
  termLength,
} from '../lib/graphFilters'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

// `n`: the author's paper count, on suggestions from the corpus only
type Option = { kind: 'keyword' | 'author'; value: string; n?: number }

const has = (list: string[], v: string) =>
  list.some((x) => x.toLowerCase() === v.toLowerCase())

// One box for a recipe's two free-text facets. What's typed is offered as a
// keyword, followed by matching author names from the corpus, so the recipe
// keeps them apart (keywords and authors are each "any of", ANDed together)
// while there's only one thing to type into. Enter takes the highlighted
// option; on an empty box it falls through to the modal (generate).
export default function RecipeTermsInput({
  keywords,
  authors,
  onAddKeyword,
  onRemoveKeyword,
  onAddAuthor,
  onRemoveAuthor,
}: {
  keywords: string[]
  authors: string[]
  onAddKeyword: (kw: string) => void
  onRemoveKeyword: (kw: string) => void
  onAddAuthor: (name: string) => void
  onRemoveAuthor: (name: string) => void
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)

  const term = text.trim().replace(/\s+/g, ' ')
  const authorsFull = authors.length >= MAX_TERMS
  const keywordsFull = keywords.length >= MAX_TERMS

  const debounced = useDebouncedValue(term, 200)
  const lookup = !authorsFull && termLength(debounced) >= MIN_TERM_LENGTH
  const { data: suggestions } = useQuery({
    queryKey: ['authors', debounced],
    queryFn: () => fetchAuthors(debounced),
    enabled: lookup,
  })

  const options = useMemo<Option[]>(() => {
    if (!term) return []
    const out: Option[] = []
    const length = termLength(term)
    if (!keywordsFull && length >= MIN_TERM_LENGTH && !has(keywords, term))
      out.push({ kind: 'keyword', value: term })
    if (authorsFull) return out
    // Only suggestions for what's in the box now, not a stale lookup
    // (and none longer than the API takes as an author term)
    const names = (
      lookup && debounced === term ? (suggestions ?? []) : []
    ).filter((s) => termLength(s.name) <= MAX_TERM_LENGTH)
    for (const s of names)
      if (!has(authors, s.name))
        out.push({ kind: 'author', value: s.name, n: s.n })
    // The name as typed, for short names suggestions don't start at ("Yu")
    // or ones not in the corpus yet; it matches whole names only
    if (
      length >= 2 &&
      !names.some((s) => s.name.toLowerCase() === term.toLowerCase()) &&
      !has(authors, term)
    )
      out.push({ kind: 'author', value: term })
    return out
  }, [
    term,
    keywords,
    authors,
    keywordsFull,
    authorsFull,
    lookup,
    debounced,
    suggestions,
  ])

  const open = focused && options.length > 0
  const activeIndex = Math.min(active, options.length - 1)

  const pick = (o: Option) => {
    if (o.kind === 'keyword') onAddKeyword(o.value)
    else onAddAuthor(o.value)
    setText('')
    setActive(0)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Keys handled here stay away from the modal's Enter/Escape handlers
    // Keys during an IME composition (CJK input) belong to the IME: the Enter
    // or Escape that ends one mustn't add a chip or reach the modal either
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      e.stopPropagation()
      return
    }
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.key === 'ArrowDown' && open) {
      handled()
      setActive((activeIndex + 1) % options.length)
    } else if (e.key === 'ArrowUp' && open) {
      handled()
      setActive((activeIndex - 1 + options.length) % options.length)
    } else if (e.key === 'Enter' && term) {
      // Text that can't be added yet (too short) mustn't generate either
      handled()
      if (open) pick(options[activeIndex])
    } else if (e.key === 'Escape' && text) {
      handled()
      setText('')
    } else if (e.key === 'Backspace' && !text && !e.repeat) {
      // Not on auto-repeat: holding Backspace to clear the text mustn't go
      // on to remove every chip
      if (keywords.length > 0) onRemoveKeyword(keywords[keywords.length - 1])
      else if (authors.length > 0) onRemoveAuthor(authors[authors.length - 1])
    }
  }

  const chip = (
    key: string,
    label: React.ReactNode,
    title: string,
    onRemove: () => void,
  ) => (
    <button
      key={key}
      type='button'
      onClick={() => {
        onRemove()
        inputRef.current?.focus()
      }}
      title={title}
      aria-label={title}
      className='shrink-0 max-w-full inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-md border border-neutral-600 bg-neutral-800 text-xs text-neutral-200 hover:border-neutral-400 cursor-pointer'
    >
      <span className='truncate inline-flex items-center gap-1'>{label}</span>
      <X size={12} className='shrink-0 text-neutral-400' aria-hidden />
    </button>
  )

  const renderOption = (o: Option, i: number) => (
    <li
      key={`${o.kind}:${o.value}:${o.n ?? ''}`}
      id={optionId(i)}
      role='option'
      aria-selected={i === activeIndex}
      // Keep focus in the input
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(o)}
      onMouseEnter={() => setActive(i)}
      className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${i === activeIndex ? 'bg-neutral-800 text-white' : 'text-neutral-300'}`}
    >
      {o.kind === 'keyword' ? (
        <Search size={13} className='shrink-0 text-neutral-500' aria-hidden />
      ) : (
        <User size={13} className='shrink-0 text-[#4ea8de]' aria-hidden />
      )}
      <span className='min-w-0 truncate'>
        {o.kind === 'keyword' ? (
          <>
            Keyword{' '}
            <span className='text-neutral-100'>{keywordLabel(o.value)}</span>
          </>
        ) : o.n === undefined ? (
          <>
            Author <span className='text-neutral-100'>“{o.value}”</span>
          </>
        ) : (
          o.value
        )}
      </span>
      {o.n !== undefined && (
        <span className='ml-auto shrink-0 text-xs text-neutral-500'>
          {o.n.toLocaleString()} {o.n === 1 ? 'paper' : 'papers'}
        </span>
      )}
    </li>
  )

  const listId = `${id}-options`
  const optionId = (i: number) => `${id}-option-${i}`
  const placeholder =
    keywordsFull && authorsFull
      ? `Up to ${MAX_TERMS} keywords and ${MAX_TERMS} authors`
      : keywords.length + authors.length > 0
        ? 'Add another…'
        : 'Keyword or author, e.g. sparse autoencoder'

  return (
    <div className='flex flex-col gap-1.5 px-4 pt-3'>
      <label htmlFor={`${id}-input`} className='text-xs text-neutral-500'>
        Keywords and authors
      </label>
      <div className='relative'>
        <div
          onClick={() => inputRef.current?.focus()}
          className='flex flex-wrap items-center gap-1.5 min-h-8 px-2 py-1 rounded-md bg-neutral-900 border border-[#333333] focus-within:ring-2 focus-within:ring-[#4ea8de] cursor-text'
        >
          {authors.map((a) =>
            chip(
              `author:${a}`,
              <>
                <User
                  size={12}
                  className='shrink-0 text-[#4ea8de]'
                  aria-hidden
                />
                <span className='truncate'>{a}</span>
              </>,
              `Remove author ${a}`,
              () => onRemoveAuthor(a),
            ),
          )}
          {keywords.map((k) =>
            chip(
              `kw:${k}`,
              <span className='truncate'>{keywordLabel(k)}</span>,
              `Remove keyword ${k}`,
              () => onRemoveKeyword(k),
            ),
          )}
          <input
            ref={inputRef}
            id={`${id}-input`}
            role='combobox'
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete='list'
            aria-activedescendant={open ? optionId(activeIndex) : undefined}
            value={text}
            maxLength={MAX_TERM_LENGTH}
            disabled={keywordsFull && authorsFull}
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value)
              setActive(0)
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            className='flex-1 min-w-[12rem] bg-transparent py-0.5 text-sm text-[#e5e5e5] placeholder:text-neutral-500 outline-none'
          />
        </div>
        {open && (
          <ul
            id={listId}
            role='listbox'
            aria-label='Add a keyword or author'
            className='absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-auto rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-lg'
          >
            {options.map(renderOption)}
          </ul>
        )}
      </div>
      <p className='text-xs text-neutral-500'>
        Keywords match the title or abstract. Papers need any one of the
        keywords and any one of the authors.
      </p>
    </div>
  )
}
