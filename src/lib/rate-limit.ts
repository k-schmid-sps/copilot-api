import consola from "consola"

import type { State } from "./state"

import { HTTPError } from "./error"
import { sleep } from "./utils"

// Serializes all callers through this gate so concurrent requests can't each
// read the same stale `lastRequestTimestamp`, compute overlapping wait
// times, and then all release together in a burst (defeating the point of
// the rate limit). Every call awaits the previous one before doing its own
// check, so requests are spaced out one at a time instead of in waves.
const noop = () => {}

let gate: Promise<void> = Promise.resolve()

export async function checkRateLimit(state: State) {
  if (state.rateLimitSeconds === undefined) return

  const previousGate = gate
  let releaseGate = noop
  gate = new Promise<void>((resolve) => {
    releaseGate = resolve
  })
  await previousGate

  try {
    const now = Date.now()

    if (!state.lastRequestTimestamp) {
      state.lastRequestTimestamp = now
      return
    }

    const elapsedSeconds = (now - state.lastRequestTimestamp) / 1000

    if (elapsedSeconds > state.rateLimitSeconds) {
      state.lastRequestTimestamp = now
      return
    }

    const waitTimeSeconds = Math.ceil(state.rateLimitSeconds - elapsedSeconds)

    if (!state.rateLimitWait) {
      consola.warn(
        `Rate limit exceeded. Need to wait ${waitTimeSeconds} more seconds.`,
      )
      throw new HTTPError(
        "Rate limit exceeded",
        Response.json({ message: "Rate limit exceeded" }, { status: 429 }),
      )
    }

    const waitTimeMs = waitTimeSeconds * 1000
    consola.warn(
      `Rate limit reached. Waiting ${waitTimeSeconds} seconds before proceeding...`,
    )
    await sleep(waitTimeMs)
    // Use the post-wait time, not the pre-wait `now` - otherwise the tracked
    // timestamp drifts behind the actual spacing between requests. Safe
    // despite the require-atomic-updates warning: the `gate` above already
    // guarantees only one caller reaches this point at a time.
    // eslint-disable-next-line require-atomic-updates
    state.lastRequestTimestamp = Date.now()
    consola.info("Rate limit wait completed, proceeding with request")
  } finally {
    releaseGate()
  }
}
