import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import GraphTour from './GraphTour'
import { TOUR_STEPS } from './tourSteps'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const title = () => screen.getByRole('dialog').querySelector('h2')?.textContent

describe('GraphTour', () => {
  it('steps forward and back', async () => {
    render(<GraphTour onClose={() => {}} />)
    expect(title()).toBe(TOUR_STEPS[0].title)
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(title()).toBe(TOUR_STEPS[1].title)
    expect(screen.getByText(`2 / ${TOUR_STEPS.length}`)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(title()).toBe(TOUR_STEPS[0].title)
  })

  it('supports arrow keys', async () => {
    render(<GraphTour onClose={() => {}} />)
    await userEvent.keyboard('{ArrowRight}')
    expect(title()).toBe(TOUR_STEPS[1].title)
    await userEvent.keyboard('{ArrowLeft}')
    expect(title()).toBe(TOUR_STEPS[0].title)
  })

  it('skips from the button or Esc', async () => {
    const onClose = vi.fn()
    render(<GraphTour onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(onClose).toHaveBeenLastCalledWith('skip')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenLastCalledWith('skip')
  })

  it('finishes with Done on the last step', async () => {
    const onClose = vi.fn()
    render(<GraphTour onClose={onClose} />)
    for (let i = 1; i < TOUR_STEPS.length; i++)
      await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledWith('done')
  })

  it('highlights a present target and centres when it is missing', async () => {
    const target = document.createElement('div')
    target.setAttribute('data-tour', TOUR_STEPS[1].target!)
    target.getBoundingClientRect = () =>
      ({ top: 10, left: 20, width: 100, height: 30 }) as DOMRect
    document.body.appendChild(target)

    render(<GraphTour onClose={() => {}} />)
    // Welcome step is centred
    expect(screen.queryByTestId('tour-highlight')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByTestId('tour-highlight')).toBeInTheDocument()

    // Step 3's target isn't on the page
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.queryByTestId('tour-highlight')).toBeNull()
  })
})
