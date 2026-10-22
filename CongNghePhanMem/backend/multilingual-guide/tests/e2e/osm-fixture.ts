import type { Route } from '@playwright/test';

export function osmPayload(route: Route, elements: unknown[], searchedRadius?: number) {
  const radius = Number(new URL(route.request().url()).searchParams.get('radius_km'));
  return { source: 'openstreetmap', elements, requested_radius_km: radius,
    searched_radius_km: searchedRadius ?? radius, warning: '' };
}
