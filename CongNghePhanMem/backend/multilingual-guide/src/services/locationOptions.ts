import type { Coordinates } from './nearby';

export type LocationCoordinates = Coordinates & {
  /** Actual provider uncertainty in metres, when supplied. */
  accuracy?: number;
  /** Actual provider fix time; never replaced with the request time. */
  timestamp?: number;
};

export type LocationRequestOptions = {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
};
