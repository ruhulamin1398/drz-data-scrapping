// Pure parser for the 6-line model output. Shared by client UI and server processor.
export type Extracted = {
  name: string;
  fullAddress: string;
  phones: string[];
  extraInformation: string;
  divisionId: number;
  districtId: number;
};

export function parseExtracted(text: string): Extracted {
  const get = (key: string) => {
    const m = text.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
    return (m?.[1] ?? "").trim();
  };
  let phones: string[] = [];
  try {
    const arr = JSON.parse(get("phones"));
    if (Array.isArray(arr)) phones = arr.map(String);
  } catch { /* leave empty */ }
  return {
    name: get("name"),
    fullAddress: get("fullAddress"),
    phones,
    extraInformation: get("extraInformation").replace(/^"|"$/g, ""),
    divisionId: Number(get("divisionId")) || 0,
    districtId: Number(get("districtId")) || 0,
  };
}
