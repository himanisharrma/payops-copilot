# AI SDLC Playbook

> A lightweight software-development lifecycle for AI-assisted payment
> operations, from problem selection through monitored release.

## 1. Frame the decision

Start with the decision a user needs to make, not with a model capability.

For PayOps Copilot:

- **Decision:** What should an analyst verify next for this exception?
- **Evidence:** Persisted reconciliation status, identifiers, amounts, variance,
  source evidence, and analyst notes.
- **AI output:** A hypothesis, supporting evidence, verification steps, a
  provider-message draft, and limitations.
- **Human authority:** Approve, reject, edit outside the system, and decide the
  operational outcome.

Reconciliation arithmetic and money movement are deliberately outside the AI
decision boundary.

## 2. Define the contract

The investigation contract is structured:

| Field | Purpose |
| --- | --- |
| `likelyCause` | A bounded hypothesis, not a provider-side fact |
| `confidence` | Low, medium, or high |
| `supportingEvidence` | Evidence that must trace to supplied case context |
| `recommendedActions` | Verification steps, not financial actions |
| `providerMessage` | A request for confirmation |
| `limitations` | What the available evidence cannot establish |

Zod validates the response before it is persisted or shown.

## 3. Design the safety boundary

Required controls:

- send only selected case facts and analyst notes;
- instruct the model not to invent events, policies, or provider responses;
- treat deterministic financial calculations as authoritative;
- prohibit refunds and financial-record changes without human verification;
- use `store: false` for the model request;
- persist provider/model metadata and review state;
- maintain a deterministic fallback for local use;
- record generation and review in the audit ledger.

## 4. Build evaluation data

Create synthetic cases that represent:

- amount mismatch;
- duplicate gateway capture;
- missing gateway transaction;
- missing settlement;
- pending transaction;
- matched control case;
- sparse or contradictory evidence;
- malicious or irrelevant analyst notes.

Each case needs expected evidence references, allowed hypotheses, prohibited
claims, safe actions, and reviewer notes. Do not create a single "ideal answer"
when multiple cautious explanations could be valid.

See [AI Model Evaluation](AI-MODEL-EVALUATION.md).

## 5. Implement and test

The minimum test pyramid is:

1. Schema and deterministic fallback unit tests.
2. Golden-case evaluation for grounding and prohibited actions.
3. API integration tests for authentication, tenancy, persistence, and audit.
4. Browser checks for generation, approval, rejection, and feedback.
5. Adversarial checks for prompt injection inside analyst notes.

Model evaluation and ordinary software testing are complementary. A valid JSON
response can still be unsafe or unhelpful.

## 6. Release gradually

Recommended release stages:

| Stage | Capability |
| --- | --- |
| Offline | Run the golden set; no user exposure |
| Shadow | Generate drafts without displaying or acting on them |
| Assisted | Display drafts with mandatory human review |
| Expanded | Add provider tools only after measured quality and scoped permissions |

PayOps Copilot currently represents the **assisted** stage. It does not include
autonomous action.

## 7. Measure production behavior

Track:

- investigation generation success and latency;
- schema-valid response rate;
- approval and rejection rate;
- helpful and not-helpful ratings;
- correction themes from feedback notes;
- unsupported-claim incidents;
- evidence-citation coverage;
- model and prompt version;
- cost per investigation;
- case resolution time with and without AI assistance.

Metrics should be segmented by exception type and model version. Aggregate
approval rate alone can hide a severe failure on one payment scenario.

## 8. Respond to incidents

Pause or roll back an AI version when:

- it recommends unauthorized financial action;
- unsupported provider-side claims exceed the threshold;
- schema validity drops;
- a privacy or cross-tenant issue is found;
- approval quality degrades materially on a key exception type.

Incident review should preserve the input class, model/prompt version, output,
reviewer decision, and remediation without retaining sensitive production data
beyond policy.

## Release checklist

- [ ] User decision and non-AI alternatives documented
- [ ] Input and output contract reviewed
- [ ] Prohibited actions encoded in instructions and tests
- [ ] Golden set passes agreed thresholds
- [ ] Model and prompt versions recorded
- [ ] Human review is visible and unavoidable
- [ ] Audit events are emitted
- [ ] Role and organization boundaries are tested
- [ ] Cost, latency, and failure behavior are understood
- [ ] Rollback path is documented

---

[Back to README](../../README.md) |
[AI Model Evaluation](AI-MODEL-EVALUATION.md) |
[Architecture](ARCHITECTURE.md)
