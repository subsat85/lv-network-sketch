// Calculation core: the types E2 reads the drawing into (types only).
//
// The core reads a project document and never writes to it: the drawing's topology
// (utils/network.ts buildNetwork) and its loads, lengths and supply systems, each with where it
// comes from. No electrical value is derived or assumed here.

import type { DistanceFlag, DrawingElement, ElectricalSettings, SupplySystem } from '../types/drawing';
import type { CircuitStatus } from '../utils/network';
import type { LengthMissing } from '../utils/spanLength';

/** The parts of the drawing document the calculation reads (the same parts the undo history keeps). */
export interface ProjectDocument {
  elements: readonly DrawingElement[];
  connectionDistances: Readonly<Record<string, string>>;
  distanceFlags: Readonly<Record<string, DistanceFlag>>;
  electrical: Readonly<ElectricalSettings>;
}

// ---------- input data: a value with where it comes from ----------

/**
 * project — stored in the project (typed or copied into the span / subscriber, or a project setting
 *           such as the default single-phase nominal load)
 * default — a rule value (the 32 A of a three-phase subscriber without a number)
 * missing — not available: no value
 */
export type Provenance = 'project' | 'default' | 'missing';
export interface Sourced<T> {
  value?: T;
  provenance: Provenance;
  /** to-check: shown but provisional (e.g. an estimated length); invalid: present but not usable */
  status?: 'complete' | 'missing' | 'to-check' | 'invalid';
  note?: string;
}

// ---------- the electrical network (built for a calculation, never saved) ----------

export interface NetLoad {
  consumerId: string;
  kind: 'single' | 'three';
  count: number;
  /** current of one subscriber, A: its label or the project's single-phase nominal load ('project'), or the 32 A rule ('default') */
  ampsEach: Sourced<number>;
  /** count × ampsEach, A; status 'invalid' (no value) when the load value cannot be a current */
  amps: Sourced<number>;
  proposed: boolean;
}
export interface NetBus { id: string; poleId: string; loads: NetLoad[] }
export interface NetBranch {
  /** `${cableId}#${index}` */
  key: string;
  cableId: string;
  index: number;
  spanId: string | undefined;
  fromPole: string;
  toPole: string;
  fromBus: string;
  toBus: string;
  color: string;
  lengthM: Sourced<number>;
  lengthMissing?: LengthMissing;
  system: Sourced<SupplySystem>;
}
export interface NetCircuit {
  id: string;
  status: CircuitStatus;
  source?: { poleId: string; kind: 'manual' | 'transformer'; bus?: string };
  /** for an 'ok' circuit in order from the source */
  buses: NetBus[];
  /** for an 'ok' circuit in order from the source, each oriented downstream */
  branches: NetBranch[];
}
export interface ElectricalNetwork { circuits: NetCircuit[] }
