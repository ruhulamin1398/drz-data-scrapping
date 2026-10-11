// Independent doctor-update utilities: each utility owns its source decision.
// Photo never needs structure_md (raw HTML og:image only). Future utilities
// (degrees, chambers) may reuse cached markdown or fetch fresh — caller never dictates.
export type UpdateType = "photo" | "experience";

export type UpdateCtx = {
  doctorQueueId: number;
  drxId: string | null;
  sourceUrl: string;
  doctorName?: string | null;
  designation?: string | null;
  speciality?: string | null;
  cardText?: string | null;
};

export type PhotoOptions = {
  skipIfPhotoExists: boolean;
};

export type ExperienceOptions = {
  skipIfExperienceSet: boolean;
};

export type PhotoOutcome =
  | { action: "skipped"; reason: string; prevPhoto: string }
  | { action: "update"; prevPhoto: string; newPhoto: string };

export type ExperienceOutcome =
  | { action: "skipped"; reason: string; prevValue: string }
  | { action: "update"; prevValue: string; newValue: string };

export type UpdateRunStatus = "pending" | "processing" | "success" | "failed" | "skipped";

export type UpdateRunRow = {
  id: number;
  doctor_queue_id: number;
  drx_id: string | null;
  source_url: string;
  type: UpdateType;
  status: UpdateRunStatus;
  options: PhotoOptions;
  result: "updated" | "skipped" | "failed" | null;
  prev_photo: string | null;
  new_photo: string | null;
  attempts: number;
  fail_reason: string | null;
  note: string | null;
};
