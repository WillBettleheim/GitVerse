"use client";

import { useState } from "react";
import type { CityLayout } from "@/lib/city/layout";
import type { SnapshotDiff } from "@/lib/timetravel/api";
import {
  buildTransition,
  changeIndexFromCities,
  type ChangeIndex,
  type TransitionPlan,
} from "@/lib/timetravel/transition";
import { TRANSITION_MS, useTimeTravelStore } from "./store";

export interface ActiveTransition {
  id: number;
  plan: TransitionPlan;
  from: CityLayout;
  to: CityLayout;
  removedEdges: SnapshotDiff["edges"]["removed"];
  addedEdges: SnapshotDiff["edges"]["added"];
  durationMs: number;
}

export interface ShownChanges {
  changes: ChangeIndex;
  addedEdges: SnapshotDiff["edges"]["added"];
}

/**
 * Turns "the city changed because of time travel" into an animation plan. Uses React's pattern
 * for adjusting state when props change, so the plan exists in the same render as the new city
 * and there's no frame of the new layout before the animation starts.
 */
export function useCityTransition(city: CityLayout, enabled: boolean, reducedMotion: boolean) {
  const request = useTimeTravelStore((s) => (enabled ? s.transition : null));
  const speed = useTimeTravelStore((s) => s.speed);
  const [tracked, setTracked] = useState({ city, requestId: request?.id ?? 0 });
  const [active, setActive] = useState<ActiveTransition | null>(null);
  const [shown, setShown] = useState<ShownChanges | null>(null);

  if (tracked.city !== city) {
    setTracked({ city, requestId: request?.id ?? tracked.requestId });
    if (request && request.id !== tracked.requestId) {
      const changes = request.changes ?? changeIndexFromCities(tracked.city, city);
      setShown({ changes, addedEdges: request.edges?.added ?? [] });
      setActive(
        reducedMotion
          ? null
          : {
              id: request.id,
              plan: buildTransition(tracked.city, city, changes),
              from: tracked.city,
              to: city,
              removedEdges: request.edges?.removed ?? [],
              addedEdges: request.edges?.added ?? [],
              durationMs: TRANSITION_MS / speed,
            },
      );
    } else {
      // A city change that isn't a time-travel step (back to latest, new analysis) shows plainly.
      setActive(null);
      setShown(null);
    }
  }

  return {
    active: enabled ? active : null,
    shown: enabled ? shown : null,
    finish: () => setActive(null),
  };
}
