export type District = { id: number; name: string };
export type Division = { id: number; name: string; districts: District[] };

export const DIVISIONS: Division[] = [
  { id: 34, name: "Dhaka", districts: [
    { id: 194, name: "Dhaka" }, { id: 196, name: "Faridpur" }, { id: 197, name: "Gazipur" },
    { id: 198, name: "Gopalganj" }, { id: 200, name: "Kishoreganj" }, { id: 201, name: "Madaripur" },
    { id: 202, name: "Manikganj" }, { id: 203, name: "Munshiganj" }, { id: 205, name: "Narayanganj" },
    { id: 206, name: "Narsingdi" }, { id: 209, name: "Rajbari" }, { id: 210, name: "Shariatpur" },
    { id: 212, name: "Tangail" },
  ]},
  { id: 35, name: "Chattogram", districts: [
    { id: 213, name: "Bandarban" }, { id: 214, name: "Brahmanbaria" }, { id: 215, name: "Chattogram" },
    { id: 216, name: "Cumilla" }, { id: 217, name: "Cox's Bazar" }, { id: 218, name: "Feni" },
    { id: 219, name: "Khagrachari" }, { id: 220, name: "Lakshmipur" }, { id: 221, name: "Noakhali" },
    { id: 222, name: "Rangamati" }, { id: 195, name: "Chandpur" },
  ]},
  { id: 36, name: "Mymensingh", districts: [
    { id: 199, name: "Jamalpur" }, { id: 204, name: "Mymensingh" },
    { id: 207, name: "Netrakona" }, { id: 211, name: "Sherpur" },
  ]},
  { id: 37, name: "Rajshahi", districts: [
    { id: 223, name: "Bogura" }, { id: 224, name: "Chapainawabganj" }, { id: 227, name: "Joypurhat" },
    { id: 230, name: "Naogaon" }, { id: 231, name: "Natore" }, { id: 233, name: "Pabna" },
    { id: 208, name: "Rajshahi" }, { id: 236, name: "Sirajganj" },
  ]},
  { id: 38, name: "Rangpur", districts: [
    { id: 225, name: "Dinajpur" }, { id: 226, name: "Gaibandha" }, { id: 228, name: "Kurigram" },
    { id: 229, name: "Lalmonirhat" }, { id: 232, name: "Nilphamari" }, { id: 234, name: "Panchagarh" },
    { id: 235, name: "Rangpur" }, { id: 237, name: "Thakurgaon" },
  ]},
  { id: 39, name: "Khulna", districts: [
    { id: 238, name: "Bagerhat" }, { id: 239, name: "Chuadanga" }, { id: 240, name: "Jashore" },
    { id: 241, name: "Jhenaidah" }, { id: 242, name: "Khulna" }, { id: 243, name: "Kushtia" },
    { id: 244, name: "Magura" }, { id: 245, name: "Meherpur" }, { id: 246, name: "Narail" },
    { id: 247, name: "Satkhira" },
  ]},
  { id: 40, name: "Barishal", districts: [
    { id: 248, name: "Barguna" }, { id: 249, name: "Barishal" }, { id: 250, name: "Bhola" },
    { id: 251, name: "Jhalokathi" }, { id: 252, name: "Patuakhali" }, { id: 253, name: "Pirojpur" },
  ]},
  { id: 41, name: "Sylhet", districts: [
    { id: 254, name: "Habiganj" }, { id: 255, name: "Maulvibazar" },
    { id: 256, name: "Sunamganj" }, { id: 257, name: "Sylhet" },
  ]},
];

export function locationBlock(divisionId: number): string {
  const div = DIVISIONS.find((d) => d.id === divisionId);
  if (!div) return `Division id:${divisionId}`;
  return [`Division: ${div.name} (id:${div.id})`, ...div.districts.map((d) => `${d.id}. ${d.name}`)].join("\n");
}
