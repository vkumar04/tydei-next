# Off-contract diagnostic — Medtronic Spine Hardware (cmo6j6g2p002cachleaux2rpy)

> **Classification: (a) — same-vendor rows un-matched / pre-match.**
>
> The $4,467,188 contract from Charles's iMessage screenshot does not exist
> in this seed. Per the plan's fallback ("use the first `contractType IN
> (usage, tie_in)` contract on the demo facility"), we ran the diagnostic
> on `Medtronic Spine Hardware` (`cmo6j6g2p002cachleaux2rpy`,
> totalValue $1,800,000, vendor `cmo6j6fxg000cachlzdh28fvi`).
>
> All 164 in-scope COG rows are `matchStatus: pending` (enrichment has not
> run in this seed). That means:
>
> - Nothing lands in the "On Contract" bucket (`on_contract` / `price_variance`).
> - Nothing lands in the "Not Priced" bucket (`off_contract_item`).
> - Nothing lands in the "Off Contract" bucket (`out_of_scope` / `unknown_vendor`).
>
> In Charles's production DB the same 164 rows (same vendor, same
> `contractId: null`) would be stamped `out_of_scope` once the vendor
> matcher runs — and THAT is where the $4.7M "Off Contract" number comes
> from in the screenshot. It is classification **(a)**: same-vendor
> out-of-scope un-matched rows rolling up into the leakage bucket,
> where the user's mental model of "leakage" is actually reserved for
> genuine different-vendor purchasing (`unknown_vendor`).
>
> Task 2 (split `preMatch` from `offContract`) is therefore IN scope.

- Vendor: cmo6j6fxg000cachlzdh28fvi
- Facility: cmo6j6fx70004achlf8fr82h2
- Contract totalValue: $1800000

## By matchStatus

| matchStatus | count | sum spend |
|---|---:|---:|
| pending | 164 | $733220 |

## Top 20 rows in scope

| vendorItem | desc | contractId | vendorId | matchStatus | spend | date |
|---|---|---|---|---|---:|---|
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $17800 | 2026-03-05 |
| MDT-IBG-001 | INFUSE Bone Graft Large Kit | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $13600 | 2026-02-10 |
| MDT-PLP-001 | PRESTIGE LP Cervical Disc | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $12400 | 2026-02-10 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2027-05-23 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2027-01-29 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2025-09-20 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2027-03-19 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2026-11-07 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2027-11-13 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2028-03-02 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2027-11-07 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2028-02-07 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2026-03-29 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2025-10-26 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2027-08-30 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2025-10-24 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2025-08-02 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2025-09-23 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2027-07-23 |
| MDT-SOL-001 | CD HORIZON SOLERA Spinal System | (null) | cmo6j6fxg000cachlzdh28fvi | pending | $8900 | 2026-06-16 |
