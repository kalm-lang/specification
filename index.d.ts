export interface Specification {
  majorMinor: string;
  specificationVersion: string;
  status: 'draft' | 'final';
  file: string;
}

export interface ListSpecificationsOptions {
  /** Include draft documents in addition to final specifications. Defaults to false. */
  includeDrafts?: boolean;
}

export interface GetSpecificationOptions {
  /** Select a draft explicitly. Defaults to final. */
  status?: Specification['status'];
}

export declare const latestVersion: string;
export declare function listSpecifications(options?: ListSpecificationsOptions): Specification[];
export declare function getSpecification(version: string, options?: GetSpecificationOptions): string;
