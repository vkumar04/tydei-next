# V0 Feature Ledger

_Auto-generated from `/Users/vickkumar/Downloads/b_kkwtOYstuRr`_
_1710 entries across 154 files — last built 2026-04-16T00:06:55.970Z_

> Tripwire ledger. Every string below is a user-visible feature in the v0 prototype. 
> If tydei is missing a non-deprecated entry from this list, we've deleted a real feature. 
> Run `bun run scripts/build-v0-feature-ledger.ts --check` to diff against the committed ledger.

## `/admin`
  **Button:** `Add Facility`, `Add User to Organization`, `Add Vendor`, `Manage Billing & Subscriptions`, `Onboard New Facility`, `Onboard New Vendor`
  **CardTitle:** `Monthly Revenue`, `Pending Actions`, `Platform Performance`, `Quick Actions`, `Recent Activity`, `Total Facilities`, `Total Users`, `Total Vendors`

## `/admin/billing`
  **Button:** `Export Report`
  **CardTitle:** `Monthly Recurring Revenue`, `Recent Invoices`

## `/admin/facilities`
  **Button:** `Add Facility`, `Cancel`
  **DialogTitle:** `Add New Facility`
  **Input@placeholder:** `City, State`, `Enter facility name`, `Search facilities...`, `admin@facility.com`
  **Label:** `Facility Name`, `Location`, `Primary Contact Email`

## `/admin/payor-contracts`
  **Button:** `Add Contract`, `Cancel`, `Close`, `Export Rates`
  **CardTitle:** `Active Contracts`, `Contract List`, `Implant Passthrough`, `Multiple Procedure Rule`, `Notes`, `Payors Covered`, `Total CPT Rates`, `Total Contracts`
  **DialogTitle:** `- Contract Rates`, `Upload Payor Contract`
  **Input@placeholder:** `Search contracts...`, `e.g., ASC-2024-001`
  **Label:** `Contract Number`, `Contract PDF`, `Contract Type`, `Effective Date`, `Expiration Date`, `Facility *`, `Notes`, `Payor Name *`
  **SelectValue@placeholder:** `Select facility...`, `Select payor...`
  **TabsTrigger:** `CPT Rates ( )`, `Contract Terms`, `Groupers ( )`
  **Textarea@placeholder:** `Add any notes about this contract...`

## `/admin/users`
  **Button:** `Add User`, `Cancel`, `Save Changes`, `Send Invitation`
  **DialogTitle:** `Add New User`, `Edit User Access & Notifications`
  **Input@placeholder:** `Add email address`, `Enter email address`, `Enter full name`, `Search users...`, `user@example.com`
  **Label:** `Current Organization Access`, `Email *`, `Full Name *`, `Health System Access`, `Individual Facility Access`, `Notification Email Addresses`, `Notification Emails`, `Notification Settings`, `Notification Types`, `Role`, `User Type *`, `Vendor Company & Division Access`
  **TabsTrigger:** `Facility User`, `Vendor User`

## `/admin/vendors`
  **Button:** `Add Vendor`, `Cancel`
  **DialogTitle:** `Add New Vendor`
  **Input@placeholder:** `Enter vendor name`, `Search vendors...`, `admin@vendor.com`, `e.g., Orthopedics`
  **Label:** `Category`, `Primary Contact Email`, `Vendor Name`

## `/auth/error`
  **Button:** `Try again`
  **CardTitle:** `Authentication Error`

## `/auth/login`
  **Button:** `Facility Demo`, `Vendor Demo`
  **CardTitle:** `Welcome back`
  **Input@placeholder:** `you@example.com`

## `/auth/sign-up`
  **CardTitle:** `Create an account`
  **Input@placeholder:** `John Smith`, `you@example.com`
  **SelectValue@placeholder:** `Select account type`

## `/auth/sign-up-success`
  **Button:** `Back to sign in`
  **CardTitle:** `Check your email`

## `/clear-cog`
  **Button:** `Clear All COG Data`, `Go to Dashboard`, `Try Again`
  **CardTitle:** `Clear COG Data`

## `/dashboard/ai-agent`
  **Button:** `CSV`, `Cancel`, `Clear`, `Close`, `New Chat`, `PDF`, `Search`, `Upload & Index`, `Upload Document`, `View Full Document`
  **CardTitle:** `AI Report Generator`, `Document Library`, `Index Stats`, `Report Preview`
  **DialogTitle:** `Upload Document`
  **Input@placeholder:** `Ask about contracts, rebates, surgeon performance...`, `Search contract terms, clauses, pricing...`, `e.g., orthopedics, pricing, renewal`
  **Label:** `Describe your report`, `Document Type`, `Output Format`, `Tags (optional)`, `Vendor`
  **SelectValue@placeholder:** `All Types`, `All Vendors`, `Select vendor`
  **TabsTrigger:** `Chat`, `Document Search`, `Generate Reports`
  **Textarea@placeholder:** `E.g., Generate a report showing all vendor contracts with their rebate tiers, current spend, and amount needed to reach the next tier...`

## `/dashboard/alerts`
  **Button:** `Mark All Read`, `Mark Read`, `Resolve`, `View Details`
  **TabsTrigger:** `All`, `Expiring`, `Off-Contract`, `Rebates`, `Unread`

## `/dashboard/alerts/[id]`
  **Button:** `Back to Alerts`, `Dismiss Alert`, `Mark as Resolved`
  **CardTitle:** `Actions`, `Alert Details`, `Recommendations`

## `/dashboard/analysis`
  **AccordionTrigger:** `Calculation Formulas Used`
  **Button:** `Capital Contract Analysis`, `Clear Analysis`, `Download PDF`, `Edit Values`, `Export Report`, `Prospective Contract Analysis`, `Run Financial Analysis`, `Upload Different File`
  **CardTitle:** `Capital Contract Analysis Report`, `Capital Tie-In Projections`, `Cash Flow Visualization`, `Composite Score Model`, `Contract Details`, `Depreciation & Tax Savings Over Time`, `Extracted Contract Data`, `Financial Assumptions`, `MACRS Depreciation Schedule`, `Multi-Term Analysis`, `Price Lock Cost Analysis`, `Quick Analysis Insights`, `Start Prospective Analysis`, `Upload Capital Contract`, `Yearly Projections`
  **Label:** `Annual Spend Growth (%)`, `Capital Equipment`, `Contract Length`, `Contract Length (Years)`, `Contract Total ($)`, `Contract Value`, `Corporate Tax Rate (%)`, `Discount Rate (%) Cost of capital / required rate of return. Typically 6-9% for healthcare organizations.`, `Linked Product Categories`, `Payment Method`, `Projected Annual Spend`, `Projected Rebate Rate (%) The expected rebate percentage based on projected spend and contract tier structure`, `Rebate Rate`, `Vendor`
  **TabsTrigger:** `Contract Inputs`, `Financial Analysis`, `Summary Report`, `Upload Contract`, `Yearly Projections`

## `/dashboard/analysis/prospective`
  **Button:** `Analyze Proposal`, `Delete Proposal`, `Export Analysis`, `Generate Report`, `Share with Team`
  **CardTitle:** `Analyzed Proposals`, `Contract Details`, `Financial Projections (COG-Based)`, `Manual Entry`, `Negotiation Recommendations`, `Previous Pricing Analyses`, `Pricing Comparison:`, `Risk Analysis`, `Score Breakdown`, `Score Details`, `Upload Contract Document`, `Upload Pricing File`, `Your COG Data`
  **Input@placeholder:** `e.g., Arthrex`
  **Label:** `Base Discount (%)`, `Contract Length (years)`, `Market Share Commitment (%)`, `Minimum Spend Commitment`, `Product Category`, `Rebate (%)`, `Total Contract Value`, `Vendor Name`
  **TabsTrigger:** `All Proposals ( )`, `Analysis`, `Pricing Analysis`, `Upload Proposal`

## `/dashboard/case-costing`
  **Button:** `Cancel`, `Clear`, `Compare Surgeons`, `First`, `Last`, `Remove file`, `Reports`, `Select`, `Upload Data`
  **CardTitle:** `Case Records ( )`, `Contract Compliance`, `Facility Averages (Reference)`, `Filter Cases`, `Margin Calculation`, `Performance Radar`, `Score Definitions`, `Total Cases`, `Total Margin`, `Total Spend`
  **DialogTitle:** `Case Details:`, `Upload Purchasing and Clinical Data Files`
  **Input@placeholder:** `Search cases...`, `Search surgeons...`
  **Label:** `Case Date`, `Facility`, `Patient Type`, `Procedure Code`, `Search`, `Select Facility for Import *`, `Surgeon`
  **SelectValue@placeholder:** `All Specialties`, `All facilities`, `All procedures`, `All surgeons`, `Choose facility for this data...`, `Sort by`
  **TabsTrigger:** `Cases`, `Implants ( )`, `Margin Analysis`, `Overview`, `Payor Mix`, `Scorecard`, `Surgeon Scorecard`, `Vendor Spend`

## `/dashboard/case-costing/compare`
  **CardTitle:** `Average Margin per Case`, `Average Spend per Case`, `National Benchmark:`, `Select Comparison Criteria`, `Surgeon Performance Comparison`, `What-If Analysis: Vendor Switch Scenario`
  **Label:** `Procedure Code *`, `Surgeons (optional)`
  **SelectValue@placeholder:** `All surgeons`, `Select procedure`

## `/dashboard/case-costing/reports`
  **Button:** `Email`, `Export PDF`, `Print`
  **CardTitle:** `Average Cost by CPT Code`, `Average Margin by CPT Code`, `Avg Margin`, `Contract Compliance`, `Contract Compliance by Surgeon`, `Cost Breakdown by Category`, `Monthly Cost & Case Trends`, `Monthly Performance Summary`, `Procedure Performance Summary`, `Rebate Contribution Details`, `Rebate Contribution by Surgeon`, `Rebate Optimization Opportunities`, `Report Filters`, `Surgeon Performance Comparison`, `Surgeon Performance Details`, `Total Cases`, `Total Rebates`
  **Label:** `Date Range`, `Procedure`, `Report Type`, `Surgeon`
  **TabsTrigger:** `Cost Trends`, `Procedure Analysis`, `Rebate Contribution`, `Surgeon Comparison`

## `/dashboard/cog-data`
  **Button:** `Add COG Entry`, `Add Entry`, `Add Item`, `Back to selection`, `COG Usage Data POs, invoices, transactions`, `Cancel`, `Clear`, `Clear All`, `Clear All Data`, `Clear Filters`, `Export All`, `First`, `Import Data`, `Last`, `Link Contract`, `Mass Upload`, `Mass Upload Upload multiple files at once`, `Match Pricing`, `Next`, `No, this is`, `Previous`, `Pricing File Price lists, catalogs`, `Save`, `Save Changes`, `Upload Different File`, `Yes, proceed as`
  **CardTitle:** `Detected:`, `Pricing List`, `Uploaded COG Files`, `Uploaded Pricing Files`
  **DialogTitle:** `Add COG Entry`, `Add Pricing Item`, `Edit COG Record`, `Link Pricing File to Contract`
  **Input@placeholder:** `0.00`, `Full item description`, `INV-XXXXXX`, `Product description`, `Reason...`, `Search by description, vendor item, or inventory number...`, `Search items, SKUs...`, `Vendor reference number`, `e.g., Arthrex Inc`, `e.g., CUSTOM-001`, `e.g., Knee`
  **Label:** `Category`, `Contract Price *`, `Description *`, `Effective Date`, `Expiration Date`, `List Price`, `Reason for Adding *`, `Vendor *`, `Vendor Item # *`
  **SelectValue@placeholder:** `All Categories`, `All Facilities`, `All Vendors`, `Choose a contract...`, `Select manufacturer`
  **TabsTrigger:** `COG Data`, `COG Files`, `Pricing Files`, `Pricing List`
  **Textarea@placeholder:** `Explain why this item is being added manually (e.g., special negotiation, trial product, one-off purchase)`

## `/dashboard/contract-renewals`
  **Button:** `Cancel`, `Close`, `Configure`, `Configure Alerts`, `Contact Vendor`, `Export Calendar`, `Generate Summary`, `Save Settings`, `View Full Contract`
  **CardTitle:** `Contracts by Status`, `Renewal Timeline`
  **DialogTitle:** `Configure Renewal Alerts`
  **Input@placeholder:** `#contract-renewals`, `email@example.com, another@example.com`
  **Label:** `30 days before expiration`, `60 days before expiration`, `90 days before expiration`, `Email Recipients`, `Enable Slack notifications`, `Slack Channel`, `Weekly summary digest`
  **SelectValue@placeholder:** `Filter by vendor`
  **TabsTrigger:** `All`, `Critical ( )`, `On Track`, `Upcoming`, `Warning ( )`

## `/dashboard/contracts`
  **Button:** `Cancel`, `Clear Selection`, `Create your first contract`, `Delete`, `New Contract`
  **CardTitle:** `Contract Overview`, `Contract Terms`, `Financial Performance`, `Pricing Items Comparison`, `Rebate Terms Comparison`, `Select Contracts to Compare`, `Total Contract Value`, `Total Contracts`, `Total Rebates Earned`
  **DialogTitle:** `Delete Contract`
  **Input@placeholder:** `Search contracts, vendors, IDs...`
  **SelectValue@placeholder:** `All Facilities`, `All Status`, `All Types`
  **TabsTrigger:** `All Contracts`, `Compare`

## `/dashboard/contracts/[id]`
  **Button:** `Add Amendment`, `Apply Amendment`, `Approve Contract`, `Back`, `Back to Contracts`, `Cancel`, `Continue to Pricing`, `Edit Contract`, `Export`, `Extract & Review Changes`, `Reject`, `Remove & Upload Different File`, `Request Revision`, `Review & Confirm`, `Send Revision Request`, `Upload Document`
  **CardTitle:** `Commitment Progress`, `Compliance Status`, `Contract Details`, `Contract Documents`, `Monthly Spend Trend`, `Rebate Performance`, `Rebate Tiers`
  **DialogTitle:** `Add Contract Amendment`
  **Input@placeholder:** `e.g., Amendment #3 - Price Adjustment`
  **Label:** `Amendment Document *`, `Amendment Title *`, `Description (Optional)`, `Effective Date *`, `How should pricing be handled?`, `Upload Pricing File`
  **TabsTrigger:** `Documents`, `Overview`, `Performance`, `Rebates & Tiers`, `Transactions`
  **Textarea@placeholder:** `Brief description of what this amendment changes...`, `Please describe what needs to be revised...`

## `/dashboard/contracts/[id]/edit`
  **Button:** `Approve Changes`, `Cancel`, `Pending Changes`, `Reject Changes`
  **CardTitle:** `Additional Details`, `Basic Information`, `Contract Dates`, `Contract Status`, `Contract Terms & Rebate Structure`
  **DialogTitle:** `Pending Vendor Changes`
  **Label:** `Contract ID`, `Contract Name`, `Contract Type`, `Description`, `Effective Date`, `Expiration Date`, `Internal Notes`, `Product Category`, `Status`, `Total Contract Value`, `Vendor`
  **TabsTrigger:** `Contract Details`, `Terms & Rebates`

## `/dashboard/contracts/[id]/score`
  **Button:** `Back to Contract`, `Back to Contracts`, `Upload Benchmark CSV`
  **CardTitle:** `Is This Contract a Good Deal?`, `Key Performance Indicators`, `National Industry Benchmarks`, `Recommended Actions`, `Score Breakdown`, `Score Trend Over Time`
  **TabsTrigger:** `Actions`, `Benchmarks`, `Overview`, `Trends`

## `/dashboard/contracts/[id]/terms`
  **Button:** `Add First Term`, `Add Term`, `Add Tier`, `Cancel`, `Save Changes`
  **DialogTitle:** `Add New Contract Term`, `Edit Contract Term`
  **Input@placeholder:** `0.00`, `No limit`, `e.g., Annual Volume Rebate`
  **Label:** `Term Name`, `Term Type`, `Tier Structure`

## `/dashboard/contracts/new`
  **Button:** `Cancel`, `Clear`, `Clear All`, `Remove`, `Select All`
  **CardTitle:** `Basic Information`, `Contract Dates`, `Contract Documents`, `Contract Documents & Pricing`, `Contract Options`, `Contract Terms`, `Financial Details`, `Linked Pricing File`, `Select Facilities`, `Tie-In Configuration`
  **Input@placeholder:** `e.g., ART-2024-001`, `e.g., Arthrex2024`
  **SelectValue@placeholder:** `Select capital contract`, `Select facility for this contract`, `Select type`, `Select vendor`
  **TabsTrigger:** `AI Assistant`, `Manual Entry`, `Upload PDF`
  **Textarea@placeholder:** `Contract notes and details...`

## `/dashboard/invoice-validation`
  **Button:** `Add Invoices`, `Approve`, `Back to options`, `Cancel`, `Close`, `Dispute Selected`, `Dispute with Vendor`, `Export Report`
  **CardTitle:** `Invoice Discrepancies`, `Monthly Recovery Progress`
  **DialogTitle:** `Import New Invoices`, `Invoice`
  **Input@placeholder:** `0.00`, `123 Vendor St, City, State ZIP`, `ACCT-XXXXX`, `Any additional notes or special instructions...`, `BOL-XXXXX`, `INV-XXXXX`, `PO-2024-XXX`, `Product description`, `SHP-XXXXX`, `SKU-XXX`, `Search invoices...`, `Type to search by product code or description...`
  **Label:** `&nbsp;`, `Bill of Lading #`, `Description`, `Discount`, `Due Date`, `Invoice Date *`, `Invoice Number *`, `Item/SKU`, `Notes / Special Instructions`, `PO Number *`, `Payment Terms`, `Qty`, `Remit-To Address`, `Search Product`, `Shipment/Packing Slip #`, `Shipping`, `Subtotal`, `Tax Amount`, `Unit Price`, `Vendor Account #`, `Vendor Name *`
  **SelectValue@placeholder:** `Select vendor`, `Status`, `Vendor`

## `/dashboard/purchase-orders`
  **Button:** `Add Exception`, `Add Exception Item`, `Add to Order`, `Approve`, `Cancel`, `Close`, `Export`, `New Bill Only PO`, `Reject`, `Save as Draft`, `Scan Barcode`, `Scan PO`, `Search Products`, `Submit PO`
  **CardTitle:** `Completed`, `Drafts`, `Purchase Orders ( )`, `Sent to Vendors`, `Total PO Value`
  **DialogTitle:** `Create Bill Only PO`, `Purchase Order Details`
  **Input@placeholder:** `0.00`, `1`, `Billing address`, `Description`, `Full description of the item...`, `Internal notes (not sent to vendor)`, `Lot`, `Medical Record Number`, `Product Name *`, `Qty`, `Reason for exception (optional)`, `S/N`, `SKU`, `Scan barcode or enter UDI/SKU...`, `Search by PO ID or vendor...`, `Type product code, SKU, or description...`, `Unit Price *`, `e.g., 4100-200`, `e.g., CUSTOM-001`, `e.g., Custom Implant Kit`, `e.g., Deliver to Loading Dock B`, `e.g., JD`, `e.g., ORTHO, SURG`, `e.g., Special order for complex case, not in standard catalog`
  **Label:** `Bill-To Address`, `Department Code`, `Description`, `GL Code / Cost Center`, `Internal Notes`, `PO Date *`, `Patient Initials`, `Patient MRN`, `Payment Terms`, `Procedure Date`, `Product Name *`, `Quantity`, `Reason for Exception`, `SKU / Item Number`, `Select Vendor *`, `Special Instructions`, `Unit Price *`
  **SelectValue@placeholder:** `All Status`, `Choose a vendor`

## `/dashboard/rebate-optimizer`
  **Button:** `+`, `Calculate`, `Close`, `Take Action`, `View Contract`, `View Rebate Reports`
  **CardTitle:** `AI Recommendations`, `Contract Tier Progress`, `Rebate Earnings by Contract`
  **DialogTitle:** `Rebate Calculator`
  **Input@placeholder:** `Enter amount...`
  **Label:** `Additional Spend Amount`
  **SelectValue@placeholder:** `Filter by vendor`

## `/dashboard/reports`
  **AccordionTrigger:** `items`
  **Button:** `Add Schedule`, `Cancel`, `Create Schedule`, `Edit`, `Export`, `Export Audit`, `Export PDF`, `Export to CSV`, `Schedule Report`
  **CardTitle:** `Calculation Audit Report`, `Capital Contract Performance`, `Contract Information`, `Contract Life Cycle`, `Contract Performance Details`, `Contract Progress`, `Earned Rebate Monthly`, `Exclusions & Non-Eligible Items`, `Grouped Contract Report`, `Key Contract Metrics`, `Monthly Spend Trend`, `Overview`, `Pricing Only Contract`, `Rebate Calculation Breakdown`, `Scheduled Reports`, `Service Contract Performance`, `Source Documents - Purchase Orders & Items`, `Tie-In Contract Performance`, `Tier Structure`, `True-Up Calculation`
  **DialogTitle:** `Add Report Schedule`
  **Input@placeholder:** `e.g., Weekly Rebate Summary`, `e.g., john@hospital.com, jane@hospital.com`
  **Label:** `Frequency`, `Options`, `Recipients (comma-separated emails)`, `Report Type`, `Schedule Name`
  **SelectValue@placeholder:** `Contract`, `Facility`, `Select frequency`, `Select report type`, `Vendor`
  **TabsTrigger:** `Calculation Audit`, `Capital`, `Grouped`, `Overview`, `Pricing Only`, `Service`, `Tie-In`, `Usage`

## `/dashboard/reports/price-discrepancy`
  **Button:** `Cancel`, `Close`, `Dispute`, `Export Report`, `Flag`, `Resolve`, `Submit Dispute`
  **CardTitle:** `Avg Discrepancy`, `Discrepancy Details`, `Flagged Issues`, `Pending Review`, `Total Overcharges`
  **DialogTitle:** `Price Discrepancy Details`, `Submit Price Dispute`
  **Input@placeholder:** `Search by item, vendor, PO number...`
  **SelectValue@placeholder:** `Filter by contract`, `Filter by vendor`, `Status`, `Type`
  **Textarea@placeholder:** `Describe the issue and any supporting information...`

## `/dashboard/settings`
  **Button:** `Accept`, `Add`, `Add Category`, `Add Facility`, `Add Vendor`, `Add an email address`, `Cancel`, `Change Avatar`, `Change password`, `Contact Enterprise Sales`, `Copy Link`, `Delete`, `Disconnect`, `Enable`, `Export`, `Invite Member`, `Invite Vendor`, `Invoice`, `Manage Plan`, `Revoke`, `Save Organization Settings`, `Send Invitation`, `Send Invite`, `Update`, `Upgrade Plan`
  **CardTitle:** `/mo`, `Account`, `Automatic Category Extraction`, `Billing & Membership`, `Credit Costs Reference`, `Danger Zone`, `Facilities`, `Feature Modules`, `Feature Settings`, `Notification Preferences`, `Organization Settings`, `Pending Invitations`, `Product Categories`, `Recent AI Activity`, `Team Members`, `Usage by Feature`, `Usage by Team Member`, `Vendor Connections`, `Vendor Management`, `Vendor Portal Settings`
  **DialogTitle:** `Add Facility`, `Add New Category`, `Add New Facility`, `Add Vendor`, `Invite Team Member`, `Invite Vendor to Connect`, `Manage Your Plan`
  **Input@placeholder:** `(555) 123-4567`, `123 Medical Dr, City, State`, `Enter vendor name`, `John Smith`, `Materials Manager`, `Search categories...`, `colleague@hospital.org`, `contact@facility.com`, `contact@vendor.com`, `e.g., Memorial Hospital - Main Campus`, `e.g., Memorial Hospital Main Campus`, `e.g., Ortho Trauma, Sports Medicine`, `e.g., Stryker, Arthrex, Medtronic`
  **Label:** `AI Agent`, `Address`, `Address (optional)`, `Advanced Reports`, `Case Costing`, `Category Name`, `City, State, ZIP`, `Contact Name`, `Department`, `Email`, `Email Address`, `Facility Name`, `Facility Type`, `First Name`, `Last Name`, `Message (Optional)`, `Organization Name`, `Organization Type`, `Parent Category (Optional)`, `Password`, `Personal Message (optional)`, `Phone`, `Portal Access`, `Primary Contact Email`, `Purchase Orders`, `Role`, `Surgeon Scorecard`, `Title`, `Vendor Name`, `Vendor Portal`
  **SelectValue@placeholder:** `Select department`, `Select parent category (optional)`, `Select type`
  **TabsTrigger:** `AI Credits`, `Account`, `Billing`, `Categories`, `Connections`, `Facilities`, `Features`, `Members`, `Notifications`, `Profile`, `Vendors`
  **Textarea@placeholder:** `Add a personal message to the invite...`, `Add a personal note to your invitation...`

## `/page.tsx`
  **Button:** `Facility Portal`, `Get Started`, `See Facility Portal`, `See Vendor Portal`, `Sign In`, `Vendor Portal`
  **CardTitle:** `Vendors Enter Data`, `Vendors Track Progress`, `You Stay in Control`

## `/vendor`
  **Button:** `View All`, `View Contracts`
  **CardTitle:** `Active Contracts`, `Aggregate Spend Trend`, `Contract Status`, `Market Share`, `Rebates Paid`, `Recent Contracts`, `Total Spend (On-Contract)`, `Your Market Share by Category`

## `/vendor/ai-agent`
  **Button:** `CSV`, `Cancel`, `Clear`, `New Chat`, `PDF`, `Search`, `Upload Document`
  **CardTitle:** `AI Report Generator`, `Document Library`, `Index Stats`, `Report Preview`
  **DialogTitle:** `Upload Document`
  **Input@placeholder:** `Ask about your contracts, market share, or opportunities...`, `Search contract terms, clauses, pricing...`, `e.g., orthopedics, pricing, renewal`
  **Label:** `Describe your report`, `Document Type`, `Facility`, `Output Format`, `Tags (optional)`
  **SelectValue@placeholder:** `All Facilities`, `All Types`, `Select facility`
  **TabsTrigger:** `Chat`, `Document Search`, `Generate Reports`
  **Textarea@placeholder:** `E.g., Generate a report showing all facility accounts with their contract values, volumes, and renewal dates...`

## `/vendor/alerts`
  **Button:** `View`
  **TabsTrigger:** `Active`, `Resolved`

## `/vendor/contracts`
  **Button:** `New Contract`
  **CardTitle:** `Active`, `Contracts`, `Pending Review`, `Total Contracts`, `Total Value`
  **Input@placeholder:** `Search contracts...`
  **SelectValue@placeholder:** `Status`

## `/vendor/contracts/[id]`
  **Button:** `Add Amendment`, `Add Document`, `Back to Contracts`, `Cancel`, `Edit & Resubmit`, `Export`, `Propose Changes`, `Smart Upload`, `Upload Revised Contract`
  **CardTitle:** `Contract Details`, `Contract Documents`, `Facility`, `Rebate Terms`
  **DialogTitle:** `Smart Amendment Upload`
  **Input@placeholder:** `e.g., 1, 2, A`
  **Label:** `Amendment #`, `Amendment Details`, `Document File`, `Document Type`, `Effective Date`, `New Expiration (if changing)`, `What does this amendment change?`
  **TabsTrigger:** `Documents`, `Overview`, `Terms & Tiers`, `Transactions`

## `/vendor/contracts/[id]/edit`
  **Button:** `+1% all rebates`, `40% market share`, `Add new tier`, `Cancel`, `Quarterly period`, `Submit for Approval`
  **CardTitle:** `Contract Terms & Rebate Structure`, `Describe Your Changes`, `Unsaved Changes ( )`
  **DialogTitle:** `Submit Term Changes for Approval`
  **Label:** `Message to Facility (optional)`
  **TabsTrigger:** `Contract Terms`
  **Textarea@placeholder:** `Add any notes or explanation for these changes...`, `Example: 'Increase tier 2 rebate to 6%' or 'Add a new tier at $500K spend with 8% rebate' or 'Change the performance period to quarterly'`

## `/vendor/contracts/new`
  **Button:** `Select PDF`
  **CardTitle:** `Attached Documents`, `Basic Information`, `Contract Dates`, `Contract Terms`, `Financial Details`, `Pricing File (Optional)`, `Submitting As`, `Upload Contract PDF`
  **Input@placeholder:** `0.00`, `e.g., Biologics Supply Agreement 2024`
  **SelectValue@placeholder:** `Select capital contract to link`, `Select facility`, `Select type`
  **TabsTrigger:** `AI Assistant`, `Manual Entry`, `Upload PDF`
  **Textarea@placeholder:** `Additional contract notes, special conditions, etc.`

## `/vendor/contracts/pending/[id]/edit`
  **Button:** `Back to Contracts`, `Cancel`
  **CardTitle:** `Basic Information`, `Contract Dates`, `Contract Terms`, `Description / Notes`, `Financial Details`
  **Input@placeholder:** `0.00`, `e.g., Orthopedic Implants Agreement 2024`
  **SelectValue@placeholder:** `Select facility`, `Select type`
  **Textarea@placeholder:** `Add any special terms, conditions, or notes...`

## `/vendor/invoices`
  **Button:** `Add Item`, `Cancel`, `Close`, `Download PDF`, `Mass Upload`, `New Invoice`, `Process with OCR`, `Remove`, `Save Draft`, `Scan Different File`, `Submit Invoice`
  **DialogTitle:** `Create New Invoice`, `Mass Invoice Upload`
  **Input@placeholder:** `INV-2024-0147`, `PO-2024-XXX`, `Product description`, `SKU-XXX`, `Search invoices...`
  **Label:** `Contract`, `Due Date`, `EDI 810 Invoice Content`, `Facility *`, `Invoice Date`, `Invoice Number`, `Line Items`, `PO Number`
  **SelectValue@placeholder:** `All Facilities`, `All Statuses`, `Link to contract`, `Select facility`
  **TabsTrigger:** `EDI 810`, `Manual Entry`, `OCR Scan`

## `/vendor/market-share`
  **Button:** `AI Category Manager`, `Apply Filter`, `Apply Merge`, `Cancel`, `Clear Filter`, `Clear Selection`, `Select All Visible`
  **CardTitle:** `Growth Opportunities`, `Market Share Trend`, `Market Share by Facility`, `Market Share by Facility & Category`, `Market Share by Product Category`, `Top Category`, `vs Industry Average`
  **DialogTitle:** `AI Category Manager`
  **Input@placeholder:** `Search facilities...`
  **SelectValue@placeholder:** `Time range`
  **TabsTrigger:** `Breakdown`, `Categories`

## `/vendor/performance`
  **Button:** `Clear Filters`, `Export Report`
  **CardTitle:** `Active Contracts`, `Avg Compliance`, `Contract Performance Details`, `Contract Rebate Performance`, `Monthly Rebates Paid`, `Performance Scorecard`, `Performance by Category`, `Rebate Summary`, `Rebate Tier Progress`, `Rebates Paid`, `Spend vs Target Trend`, `Total Spend`
  **SelectValue@placeholder:** `All Contracts`, `All Facilities`
  **TabsTrigger:** `By Category`, `By Contract`, `Overview`, `Rebate Progress`

## `/vendor/prospective`
  **Button:** `Add Benchmark`, `Add Category`, `Add Term`, `Add Tier`, `Cancel`, `Clear Filters`, `Close`, `Create Proposal`, `Enter notes above to generate terms`, `Export`, `Generate Deal Terms from Notes`, `Import`, `Import Benchmarks`, `Load More`, `Load Sample Benchmarks`, `Load more products (showing of )`, `New Proposal`, `Re-analyze with updated notes`, `Show All`
  **CardTitle:** `Acceptable Deals`, `Avg Deal Score`, `Avg GPO Fee`, `Avg Target Margin`, `Categories Covered`, `Deal Analysis`, `Deals by Recommendation`, `Facility Opportunities`, `My Contract Proposals Internal Use Only`, `Performance by Facility`, `Product Pricing Benchmarks`, `Revenue by Facility`, `Score Distribution`, `Select Contract`, `Total Products`, `Total Projected Spend`, `Total Proposals`
  **DialogTitle:** `Import Benchmarks`
  **Input@placeholder:** `Enter category name`, `Enter facility name`, `Search products by name or catalog #...`, `Search products...`, `Search proposals by name, category, or product...`, `Threshold`, `e.g., 3.5`, `e.g., HIP-001`, `e.g., Orthopedics, Cardiology, Neurology`, `e.g., Primary Hip System`, `e.g., Southeast Health System Group Buy`
  **Label:** `AI Deal Notes`, `Additional Facilities`, `Category`, `Contract Length (months)`, `Cost Basis`, `Discount %`, `GPO Admin Fee %`, `GPO Admin Fee (%)`, `Group Name *`, `Grouped Proposal`, `Hard Floor * Absolute minimum price - never go below this`, `Label`, `Market Share Commitment (%)`, `Market Share Pricing Tiers`, `Max Share %`, `Min Share %`, `Multi-Facility Proposal`, `National ASP * Average Selling Price across all accounts nationally`, `Or Paste CSV Data`, `Organization Divisions`, `Product Categories *`, `Product Code *`, `Product Name *`, `Products / Pricing`, `Projected Annual Spend`, `Projected Annual Volume`, `Proposed Terms`, `Rebate %`, `Target Margin %`, `Target Value`, `Term Type Contract Term Types Choose how rebates are calculated. Each type uses different metrics (spend, volume, or market share) to determine rebate amounts.`, `Upload CSV File`
  **SelectValue@placeholder:** `All Categories`, `All Products`, `All Status`, `Select facility`, `Sort By`
  **TabsTrigger:** `Analytics`, `Benchmarks`, `Deal Scorer`, `My Proposals`, `Opportunities`
  **Textarea@placeholder:** `Example: Customer is evaluating a competing offer from MedTech Corp at 15% lower pricing. They're interested in a 3-year exclusive partnership if we can match the price. Decision needed by end of month. Strong relationship with their orthopedic department - they've been a customer for 5 years.`, `Primary Hip System $8,500 50 units&#10;Revision Hip System $12,000 30 units&#10;Spinal Fusion Kit $15,000`, `Product Code,Product Name,Category,National ASP,Hard Floor,Cost Basis,Target Margin %,GPO Admin Fee %`

## `/vendor/purchase-orders`
  **Button:** `Acknowledge Order`, `Add`, `Add Exception`, `Add PO`, `Add Selected Product`, `Cancel`, `Close`, `Create Purchase Order`, `Export`, `Scan`, `Select`
  **CardTitle:** `All Purchase Orders`, `Approved`, `Fulfilled`, `In Progress`, `Pending Approval`, `Rejected`
  **DialogTitle:** `Create Purchase Order`, `Purchase Order Details`
  **Input@placeholder:** `0.00`, `Enter SKU`, `Enter product description`, `Enter product name`, `LOT/SN`, `Lot code or serial number`, `Scan barcode or enter SKU...`, `Search orders...`, `Search products by name, SKU, or category...`
  **Label:** `Add Products`, `Description`, `Facility *`, `LOT/SN`, `Notes (Optional)`, `PO Date *`, `PO Type *`, `Product Name *`, `Reason for Exception`, `SKU / Code`, `Unit Price *`
  **SelectValue@placeholder:** `Filter by status`, `Select PO type`, `Select facility`
  **Textarea@placeholder:** `Add any special instructions or notes for this order...`, `Why is this product not in the price file? (e.g., new item, special request, trial product)`

## `/vendor/renewals`
  **Button:** `Add Contract`, `Cancel`, `Close`, `Contact Facility`, `Email`, `Export Calendar`, `Export Report`, `Propose Renewal Terms`, `Send Proposal`
  **CardTitle:** `Facility Contact`, `Performance History`, `Proposed Renewal Terms`, `Renewal Notes`, `Renewal Timeline`, `Renewals by Facility`
  **DialogTitle:** `Propose Renewal Terms`
  **Label:** `Proposal Notes`
  **SelectValue@placeholder:** `Filter by facility`
  **TabsTrigger:** `Action Needed ( )`, `All`, `On Track`, `Upcoming`, `Urgent ( )`
  **Textarea@placeholder:** `Describe your proposed terms, pricing changes, or new offerings...`

## `/vendor/reports`
  **Button:** `Cancel`, `Generate Report`
  **CardTitle:** `Recent Reports`
  **DialogTitle:** `Generate`
  **Label:** `Facility`, `Report Period`
  **SelectValue@placeholder:** `Facility`

## `/vendor/settings`
  **Button:** `Accept`, `Add Payment Method`, `Cancel`, `Change Avatar`, `Change password`, `Contact Enterprise Sales`, `Disconnect`, `Download`, `Enable`, `Invite Facility`, `Manage Plan`, `Send Invite`, `Upgrade Plan`
  **CardTitle:** `/mo`, `Account`, `Billing History`, `Credit Costs Reference`, `Current Plan`, `Facility Connections`, `Notification Preferences`, `Organization Details`, `Payment Method`, `Recent AI Activity`, `Usage by Feature`, `Usage by Team Member`
  **DialogTitle:** `Invite Facility to Connect`, `Manage Your Plan`
  **Input@placeholder:** `e.g., Memorial Hospital, St. Mary's Medical Center`
  **Label:** `Company Name`, `Facility Name`, `First Name`, `Last Name`, `Message (Optional)`, `Password`, `Phone Number`, `Primary Contact Email`, `Website`
  **TabsTrigger:** `AI Credits`, `Billing`, `Connections`, `Notifications`, `Organization`, `Profile`
  **Textarea@placeholder:** `Add a personal message to the invite...`

## `_shared`
  **Button:** `Accept All High Confidence`, `Add Another Term`, `Add Contract Term`, `Add Procedure Cap`, `Add Product`, `Add Rates`, `Add Tier`, `Add Transaction`, `Add Vendor`, `Amendments`, `Answer`, `Apply Mapping`, `Approve`, `Auto-match high confidence`, `Back`, `Back to Mapping`, `Back to Vendor Match`, `Browse Files`, `COG Data`, `Cancel`, `Cancel Import`, `Capital Agreement`, `Change`, `Check for Duplicates`, `Clear`, `Clear Filters`, `Clear Selection`, `Clear filters`, `Close`, `Complete ( documents)`, `Confirm & Apply Changes`, `Confirm & Continue`, `Confirm & Create Contract`, `Confirm Mappings`, `Continue`, `Contracts`, `Create All as New Vendors`, `Create your first contract`, `Delete Term`, `Deselect All`, `Edit Name`, `Extract Data`, `Filters`, `Go to Purchase Orders`, `Grouped/GPO`, `How it works`, `Import Data`, `Import Records`, `Import Rows`, `Invoices`, `Keep All Existing`, `Keep Both`, `Keep Both (All)`, `Keep Existing`, `Market Share`, `Mass Upload`, `Match Supplies to Contracts`, `Match Vendor Names`, `Match Vendors`, `Next slide`, `No`, `No, different vendor`, `Previous slide`, `Pricing`, `Reject`, `Remove Duplicates & Continue`, `Replace All`, `Replace with Import`, `Retry Failed`, `Review Duplicates`, `Select All ( )`, `Select Files`, `Skip`, `Skip & Import`, `Standard`, `Start Over`, `Toggle Sidebar`, `Toggle theme`, `Upgrade`, `Upload Different File`, `Usage Contract`, `Vendor`, `View All`, `View all`, `Yes`, `Yes, same vendor`
  **CardTitle:** `AI Supply Matcher`, `AI-Powered Amendment Extraction`, `Access Restricted`, `Alerts`, `Amendment Details`, `Case Costing Summary`, `Contract Transactions`, `Describe Your Contract`, `How Case Costing Links Your Data`, `Import COG Data from CSV`, `Import Pricing File`, `Payor Reimbursement Rates`, `Please Confirm`, `Pricing Changes`, `Rebate Term Changes`, `Recent Contracts`, `Spend by Category`, `Top Vendors by Spend`, `Total Spend`, `Vendor Name Matching`
  **DialogTitle:** `-`, `AI Contract Import`, `Add Contract Transaction`, `Add New Vendor`, `Add Reimbursement Rates`, `Additional Information Needed`, `COG Data Import`, `Duplicate Records Detected`, `Import Data`, `Map Pricing File Columns`, `Resolve Duplicate Pricing Records`, `Vendor Name Matching`
  **Input@placeholder:** `$0`, `$0.00`, `$999,999`, `0`, `0%`, `0.00`, `100%`, `30`, `999,999`, `Calculated`, `Days`, `Description`, `Effective date`, `Enter Contract ID`, `Enter official vendor name...`, `No limit`, `Product description`, `REF`, `SKU or Part #`, `Search duplicates...`, `Search facilities by name, city, or state...`, `Search vendor names...`, `Search vendors...`, `e.g., 10`, `e.g., 27447`, `e.g., 27447, 27130`, `e.g., 27447, 27130, 22551`, `e.g., 5`, `e.g., 50`, `e.g., 5000`, `e.g., 95`, `e.g., ASC-2024-001`, `e.g., Annual Spend Rebate`, `e.g., Anthem Blue Cross`, `e.g., Check #, Invoice #, PO #`, `e.g., GROUP-1111`, `e.g., Lighthouse Surgery Center`, `e.g., Ortho Trauma, Spine`, `e.g., Robotic Surgery System`, `e.g., Total Knee Replacement`, `email@example.com, +1234567890`
  **Label:** `*`, `AI Processing Instructions (Optional)`, `Amendment Number`, `Amount *`, `Applies To`, `Balance`, `Baseline Configuration`, `Baseline Type`, `Calculation Basis`, `Cap Price (Ceiling)`, `Capitated Pricing - Procedure Caps`, `Carve Out - Capital Paydown`, `Category`, `Category Column`, `Category Contributions`, `Compliance Warning`, `Contract Extension`, `Contract ID`, `Contract Language (Source)`, `Contract Name`, `Contract Number *`, `Contract Total Total capital amount including taxes`, `Contract Type`, `Covered Facilities ( )`, `Create as new vendor:`, `Current Contribution`, `Current Market Share (%)`, `Custom Days`, `Data Type`, `Describe what you want the system to do`, `Describe what you want the system to extract`, `Description`, `Description *`, `Desired Market Share (%)`, `Desired Rebate (%)`, `Document Queue ( )`, `Early Payment Discount Tiers`, `Early Payment Incentive`, `Effective Date`, `Effective Date *`, `Effective From`, `Effective To`, `Estimated Completion`, `Expiration Date`, `Expiration Date *`, `Extracted Contract Details`, `Extracted Terms`, `Facility Name`, `Group Contract ID (Optional)`, `Growth Baseline (%)`, `Growth Baseline Settings`, `Market Share Configuration`, `Max Share %`, `Max Spend`, `Max Volume`, `Min Share %`, `Min Spend`, `Min Volume`, `No`, `Notes`, `Notification Contacts (comma-separated)`, `Notification Method`, `Official Vendor Name`, `On-Time Threshold (%)`, `PO Submission Requirements`, `Payment Period`, `Payor Name *`, `Payor Type`, `Performance Period`, `Price Discrepancy Warning`, `Prior Year Spend ($)`, `Prior Year Volume`, `Procedure Code (CPT)`, `Procedure Codes (CPT)`, `Procedure Codes (comma-separated)`, `Procedure Description`, `Processed Documents`, `Product Category`, `Product Reference Numbers`, `Product Scope`, `Rate Data`, `Rebate Terms ( )`, `Rebate Tiers`, `Rebate Type`, `Reference #`, `Reference Number`, `Select Contract`, `Show Forecast`, `Show only unmatched`, `Special Conditions`, `Spend Baseline ($)`, `Spend Baseline Settings`, `Spend Max`, `Spend Min`, `Standard Payment Terms`, `Submission Deadline`, `Summary of Changes`, `Term Name`, `Term Type Term Types Select how this contract term calculates rebates or price reductions. Each type has different threshold and calculation methods.`, `This Amendment Changes:`, `Threshold % Over Expected`, `Tiers`, `Transaction Type`, `Unit Price`, `Upload Contract File`, `Upload File`, `Upload File or Paste Rates`, `Uploaded Documents`, `Uploaded Name (will be saved as alias)`, `Vendor`, `Vendor Contact`, `Yes`
  **SelectValue@placeholder:** `All Facilities`, `All Vendors`, `Category`, `Choose a facility...`, `Choose action`, `Facility Type`, `Region`, `Select a contract...`, `Select an option`, `Select category`, `Select column`, `Select facility for this import`, `Select facility...`, `Select the column containing categories`, `Select vendor...`, `State`
  **SheetTitle:** `Sidebar`
  **TabsTrigger:** `Add to Existing`, `All ( )`, `Credits ( )`, `Mass Upload`, `New Contract`, `Payments ( )`, `Rebates ( )`, `Single File`
  **Textarea@placeholder:** `Add any special instructions for AI processing. For example:&#10;• 'Extract rebate tiers from section 4'&#10;• 'This is an amendment to contract #12345'&#10;• 'Map vendor codes to our internal format'`, `Additional notes...`, `Example: '3-year usage contract with Stryker starting January 2026. Tiered rebates: $100K gets 3%, $250K gets 5%, $500K gets 7%. Quarterly performance review, rebates paid quarterly.'`, `Example: 'These are Q1 2024 invoices from Stryker for our orthopedic department. Extract all pricing and match to existing contracts. Flag any items with price increases over 5%.'`, `Example: 'This is a usage-based rebate contract with Stryker for orthopedic implants. It has multiple tiers based on quarterly spend thresholds and includes a 2% price lock guarantee.'`
