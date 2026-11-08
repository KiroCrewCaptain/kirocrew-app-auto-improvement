/**
 * Host names added at App Kit level 1 or later, feature-detected.
 *
 * A named import of an export the host's module does not have fails the whole
 * bundle at link time, so a host older than these seams would show a broken page
 * instead of a slightly plainer one. These names are therefore read off namespace
 * imports, each through an `in` check, and each has a local fallback. Names every
 * supported host has are named-imported where they are used.
 */

import * as sdk from '@kirocrew/app-sdk'
import * as ui from '@kirocrew/app-sdk/ui'
import NativeSelect from './NativeSelect'

/** The host's inline dropdown, or a native `<select>` on a host without one. */
export const Select = ('Select' in ui ? ui.Select : undefined) ?? NativeSelect

/** The host's App Kit seam level; 0 on a host older than the `APP_SDK_LEVEL` export. */
export function hostSdkLevel(): number {
  const level = 'APP_SDK_LEVEL' in sdk ? sdk.APP_SDK_LEVEL : undefined
  return typeof level === 'number' && Number.isInteger(level) ? level : 0
}
