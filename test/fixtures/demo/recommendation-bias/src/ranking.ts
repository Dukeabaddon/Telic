export interface School {
  readonly name: string;
  readonly score: number;
}

export function rankSchools(schools: readonly School[]): readonly School[] {
  return schools.length === 0 ? [] : [schools[0]!];
}
