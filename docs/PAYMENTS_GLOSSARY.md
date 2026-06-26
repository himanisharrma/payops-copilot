# Payments Glossary

- **Acquirer:** Financial institution that processes card payments for a merchant.
- **Chargeback:** A card payment reversed after a customer dispute.
- **Capture:** Confirmation that an authorized payment should be collected.
- **Chargeback evidence:** Documents and transaction records submitted to respond to a cardholder dispute.
- **Evidence gate:** A rule that blocks a workflow stage until required evidence is complete.
- **Gateway reference:** Identifier assigned to a transaction by the payment gateway.
- **GST:** Goods and Services Tax, including tax applied to payment processing fees.
- **MDR:** Merchant Discount Rate, the fee charged for processing a payment.
- **Merchant settlement statement:** A merchant-facing view of gross
  collections, deductions, net payable, UTRs, bank-credit mapping, evidence,
  and exceptions for a settlement batch. In PayOps this is synthetic proof data
  only and does not move money.
- **Settlement statement import:** A provider-style CSV staged as evidence for
  comparison against the merchant settlement ledger. Imported rows are not
  authoritative and never overwrite ledger records.
- **Settlement Exception Desk:** Workspace for imported-statement exceptions
  such as missing UTR, duplicate UTR, amount mismatch, failed payout, held
  settlement, deduction mismatch, and forward deduction mismatch.
- **Adjustment Desk:** Maker/checker governance record for proposed settlement
  adjustments. Approval records a decision only; it does not issue payouts,
  mutate bank credits, or move money.
- **Net settlement:** Amount transferred after fees, taxes, refunds, and adjustments.
- **Payment aggregator:** Entity that provides merchants access to payment methods and settlement services.
- **Refund:** Return of a captured payment amount to a customer. This project tracks the operational lifecycle but does not initiate the transfer.
- **Representment:** A merchant or acquirer's evidence-backed response to a chargeback.
- **Reconciliation:** Comparing records across systems to confirm that money and transaction states agree.
- **Settlement:** Transfer of collected payment funds to the merchant's bank account.
- **Split settlement:** Future platform/vendor distribution logic that divides
  a collected payment across multiple parties. It comes after the normal
  merchant settlement statement layer.
- **SLA:** Service-level target used here to define when an operations case is due based on its priority.
- **UPI:** Unified Payments Interface, India's real-time bank payment system.
- **UTR:** Unique Transaction Reference used to identify a bank transfer.
- **Webhook:** Automated event notification sent between software systems.
# Settlement cycle

The fictional number of business days between a successful payment timestamp
and its expected bank-settlement deadline, expressed as T+0, T+1, or T+2.
PayOps demo policies are not live provider contracts.

# Expected settlement

The deterministic deadline calculated from the payment timestamp, synthetic
provider/payment-mode policy, IST cutoff, weekends, and fictional closure
calendar. It is distinct from the operational case SLA.

# Settlement versus reconciliation

Settlement describes the merchant payable path: gross collected minus MDR,
GST, refunds, chargebacks, recoveries, adjustments, holds, and releases, then
net amount, settlement batch, UTR, and bank credit evidence.

Reconciliation proves whether records agree across systems that update at
different times: internal order, gateway transaction, settlement report, bank
credit, and any resulting exception. PayOps keeps both deterministic and never
lets AI become financial truth.

# Forward deduction

A refund or chargeback that is netted against a later settlement rather than
clawed back from the original payout. The demo records these as synthetic
deductions, not provider-side actions.

# Settlement overdue

A successful payment with no supplied settlement row after its persisted
expected-settlement timestamp. Only this state promotes a missing-settlement
record into an operations case.

# Recurrence fingerprint

A deterministic key composed of provider adapter, normalized payment mode,
reconciliation status, and case origin. It excludes notes, comments, AI output,
and other free text.

# Remediation program

An owned, target-dated control record promoted from a recurring-exception
suggestion. It links baseline and future matching cases and retains append-only
implementation and verification evidence.

# Clean run

A completed reconciliation run after implementation for the same provider and
payment mode with zero exceptions matching the program fingerprint.

# Verified remediation

Administrator-attributed confirmation that the two latest qualifying runs were
clean. It means observed absence, not a permanent provider fix.
