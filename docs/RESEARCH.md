# Research connection: What Should Exist Outside the Model?

[Home](../README.md) · [Design](DESIGN.md) · [Status](STATUS.md)

## From product problems to research questions

ADOS began with practical delivery work: keeping confirmed decisions usable, applying earlier guidance to a new situation, recovering interrupted tasks and deciding whether an agent had really finished. These problems helped motivate **WSEOM—What Should Exist Outside the Model?**

The research agenda asks how cognitive work, accumulated experience, verification and action authority should be divided between AI models and the systems around them. ADOS is the related product and engineering direction; WSEOM is not a claim that the product has already achieved its goals.

**Public reading:** Yanyang Zhao, *What Should Exist Outside the Model?*, bilingual research agenda v0.3, [DOI: 10.5281/zenodo.22992066](https://doi.org/10.5281/zenodo.22992066).

## Four questions that matter to ADOS

### 1. Which support should a model receive?

Retrieving source material, organizing an unresolved question, supplying a reference result and making a judgment perform different work. Their value can depend on the task, recipient capability and the correctness of the support.

An end-to-end comparison should include the cost of producing, checking and maintaining that support—not only the receiving agent's tokens. ADOS should not assume that every task benefits from more external processing.

### 2. What experience should persist?

Experience may be reusable, irrelevant, stale or actively harmful. Research needs to distinguish retrieving an old record from correctly applying it under new conditions.

For continuing work, the question includes which decisions remain valid, which permissions have changed and what should be reconsidered. Successful recovery of stored state does not itself demonstrate successful transfer of experience.

### 3. When is guidance insufficient?

A supplied recommendation can influence an agent. An authorization mechanism determines whether a requested action is allowed. These are different interventions.

A useful control evaluation separates an unauthorized request from an executed violation, and also asks whether the agent can complete legitimate work after a denial. Simply counting refusals would miss both unauthorized effects and unnecessary obstruction.

The public ADOS kit checks declared authorization and consistency fields. It does **not** implement independently protected authorization records, authenticate approvals or intercept tools. Those controls require a separately evaluated execution environment.

### 4. Does the system reduce human work?

The product question is what a person can reliably delegate within a limited attention budget. Relevant work includes preparation, maintaining rules and context, interruptions, review, corrections, takeover and rework.

Fewer prompts, less model reasoning or a faster individual run do not establish a net reduction. Quality, failures and consequential risk must be measured alongside human work and resource cost.

## Keep the outcomes separate

| Observation | What it does not automatically establish |
| --- | --- |
| The relevant source was cited | The decision was correct |
| A structured record passed validation | Its claims are true |
| The agent used fewer reasoning tokens | The entire workflow cost less |
| A fixture recovered after interruption | Arbitrary real projects recover reliably |
| A supplied judgment changed behavior | A protected authority controlled the action |
| An Owner accepted one artifact | Experience transfers to later tasks |

These distinctions guide the evaluation agenda. They are not benchmark scores for this public repository.

## Evidence and publication boundaries

The author's related empirical work studies external support in controlled agent tasks. This repository does not reproduce those experiments, distribute their datasets, advertise submission status or claim that their findings validate a complete ADOS runtime. Consult the separately released research material for methods, results and limitations.

The public agenda is linked rather than copied. Unpublished papers, private review material, personal CV data, sealed evaluation inputs and raw human records are not part of this release. Scientific conclusions remain under their own research process; product changes require their own evidence and authorization.

## Useful collaboration

Concrete contributions include a task where retained guidance becomes stale, a counterexample to a proposed authority boundary, a small controlled comparison of support strategies, or an evaluation of real review and rework costs. Both positive and negative results can answer these questions; a particular direction or magnitude of improvement is not the definition of a valid experiment.
