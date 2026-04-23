# Charles W2.C short-CSV import repro

source: /Users/vickkumar/Desktop/New New New Short.csv

rows parsed: 146
headers (11):
  - Purchase Order Number
  - Vendor
  - Vendor Item Number
  - Inventory Description
  - Date Ordered
  - Return Date
  - Quantity Ordered
  - UOM Ordered
  - Conversion Factor Ordered
  - Unit Cost
  - Extended Cost

mapping by field:
  * inventoryNumber        -> Vendor Item Number
  * inventoryDescription   -> Inventory Description
    vendorName             -> Vendor
    vendorItemNo           -> Vendor Item Number
    manufacturerNo         -> (none)
  * unitCost               -> Unit Cost
    extendedPrice          -> Extended Cost
    quantity               -> Quantity Ordered
  * transactionDate        -> Date Ordered
    category               -> (none)

records built: 144
records filtered out: 2

first 5 drops:
  row 144: inventoryNumber empty
  row 145: inventoryNumber empty

OK: 144 records built (threshold 140)
