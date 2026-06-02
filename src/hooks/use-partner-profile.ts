"use client";

/**
 * usePartnerProfile
 *
 * Subscribes to the current user's partner_profiles doc (doc id === uid) and,
 * when an activeTrackId is present, subscribes to that partner_tracks doc too.
 *
 * Returns:
 *   - profile: PartnerProfile | null   (null = user is not a partner)
 *   - track:   PartnerTrack | null     (null = no active track, or track not found)
 *   - loading: boolean
 *
 * Safe to call even when the partner_profiles collection is empty — returns
 * { profile: null, track: null, loading: false } once the first snapshot fires.
 *
 * NOTE: "both tracks" (completed multiple tracks) is not representable in the
 * current PartnerProfile schema which holds only a single activeTrackId.
 * A future completedTrackIds[] field will enable that — add it to PartnerProfile
 * and extend this hook when ready.
 */

import { useEffect, useState } from "react";
import { subscribeToPartnerProfile, subscribeToPartnerTrack } from "@/lib/firestore/partners";
import type { PartnerProfile, PartnerTrack } from "@/types/partner";

export interface PartnerProfileState {
  profile: PartnerProfile | null;
  track: PartnerTrack | null;
  loading: boolean;
}

export function usePartnerProfile(uid: string | null | undefined): PartnerProfileState {
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [track, setTrack] = useState<PartnerTrack | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [trackLoading, setTrackLoading] = useState(false);

  // ---- Subscribe to partner profile ----
  useEffect(() => {
    if (!uid) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);

    const unsub = subscribeToPartnerProfile(
      uid,
      (p) => {
        setProfile(p);
        setProfileLoading(false);
      },
      (err) => {
        console.error("[usePartnerProfile] profile subscription error:", err);
        setProfile(null);
        setProfileLoading(false);
      },
    );

    return () => unsub();
  }, [uid]);

  // ---- Subscribe to active track (re-runs when activeTrackId changes) ----
  useEffect(() => {
    const trackId = profile?.activeTrackId ?? null;

    if (!trackId) {
      setTrack(null);
      setTrackLoading(false);
      return;
    }

    setTrackLoading(true);

    const unsub = subscribeToPartnerTrack(
      trackId,
      (t: PartnerTrack | null) => {
        setTrack(t);
        setTrackLoading(false);
      },
      (err: Error) => {
        console.error("[usePartnerProfile] track subscription error:", err);
        setTrack(null);
        setTrackLoading(false);
      },
    );

    return () => unsub();
  }, [profile?.activeTrackId]);

  return {
    profile,
    track,
    loading: profileLoading || trackLoading,
  };
}
