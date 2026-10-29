import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CaptureAttachmentPreview } from '../../../../web/app/(modules)/expenses/capture-attachment-preview'

vi.mock('@lumiere/i18n', async (importOriginal) => ({ ...(await importOriginal<typeof import("@lumiere/i18n")>()),
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}))
beforeAll(() => {
  URL.createObjectURL ??= () => 'blob:preview'
  URL.revokeObjectURL ??= () => {}
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('expense capture local attachment preview', () => {
  it('shows the image and revokes its URL when replaced by a PDF and on unmount', async () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:image-preview')
      .mockReturnValueOnce('blob:pdf-preview')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const image = new File(['image'], 'receipt.png', { type: 'image/png' })
    const { rerender, unmount } = render(
      <CaptureAttachmentPreview file={image} />,
    )
    await waitFor(() =>
      expect(screen.getByAltText('Selected receipt').getAttribute('src')).toBe(
        'blob:image-preview',
      ),
    )
    expect(
      screen.getByText(
        'Local preview. This file is not attached to a saved expense yet.',
      ),
    ).toBeTruthy()
    rerender(
      <CaptureAttachmentPreview
        file={new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' })}
      />,
    )
    await waitFor(() =>
      expect(
        screen.getByLabelText('Selected receipt PDF').getAttribute('data'),
      ).toBe('blob:pdf-preview'),
    )
    expect(screen.queryByAltText('Selected receipt')).toBeNull()
    expect(revoke).toHaveBeenCalledWith('blob:image-preview')
    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:pdf-preview')
  })
})
