#!/usr/bin/env python3
"""Prepare paired ERP skill trials or summarize independently graded results.

Preparation is offline. Run manifests contain no expected answers. A provider
runner must use admitted execution and record its real model, attempts and spend;
this script does not create a tenant release, dispatch a provider or auto-grade.
"""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import statistics

from erp_skill_catalog import ROOT, compile_prompt


def prepare(cases, profiles, repetitions=3):
    if repetitions < 1 or repetitions > 10:
        raise ValueError('repetitions must be in 1..10')
    if not profiles or len(set(profiles)) != len(profiles):
        raise ValueError('unique explicit model profiles are required')
    baseline = json.loads((ROOT/'erp-skills/evals/baseline.json').read_text())
    trials = []
    for case in cases:
        if case['skill'] not in baseline['skills']:
            raise ValueError('pilot baseline unavailable')
        path = ROOT/'erp-skills'/case['skill']/'SKILL.md'
        candidate = compile_prompt(path)
        for config in ['current', 'candidate']:
            prompt = baseline['skills'][case['skill']]['text'] if config == 'current' else candidate['text']
            for profile in profiles:
                for repetition in range(repetitions):
                    identifier = f"{case['id']}:{config}:{profile}:{repetition}"
                    trials.append({
                        'trialId':identifier, 'caseId':case['id'], 'skill':case['skill'],
                        'configuration':config, 'profile':profile, 'repetition':repetition,
                        'prompt':prompt, 'promptHash':hashlib.sha256(prompt.encode()).hexdigest(),
                        'binding':baseline['baselineCommit'] if config == 'current' else candidate['source_hash'],
                        'request':case['request'], 'evidenceSetup':case['evidenceSetup'],
                    })
    return trials


def stats(values):
    return {'n':len(values), 'mean':statistics.mean(values),
            'stddev':statistics.stdev(values) if len(values)>1 else 0,
            'min':min(values), 'max':max(values)}


def wilson(successes, total):
    if not total:
        return None
    z=1.96
    fraction=successes/total
    center=(fraction+z*z/(2*total))/(1+z*z/total)
    margin=z*math.sqrt(fraction*(1-fraction)/total+z*z/(4*total*total))/(1+z*z/total)
    return [max(0, center-margin), min(1, center+margin)]


def successful_task(result):
    """A claimed task success needs a correct outcome and no critical failure."""
    return result['taskSuccess'] and result['correctOutcome'] and not result['criticalFailure']


def evidence_class(result):
    """Keep valid pre-dispatch denials separate from observed provider trials."""
    if result['executionMode'] == 'immutable_fixture_replay':
        return 'fixture_replay'
    return 'live_provider' if result['providerCalls'] > 0 else 'live_without_provider'


def summarize(trials, results):
    expected = {trial['trialId']:trial for trial in trials}
    if len(expected) != len(trials):
        raise ValueError('duplicate trial identities')
    groups, seen = defaultdict(list), set()
    for result in results:
        identifier=result['trialId']
        if identifier not in expected or identifier in seen:
            raise ValueError('unknown or duplicate result identity')
        seen.add(identifier)
        trial=expected[identifier]
        for field in ['promptHash','profile','skill','configuration']:
            if result[field] != trial[field]:
                raise ValueError(f'result binding differs: {field}')
        for field in ['provider','modelRevision','runtimeBinding','fixtureHash','reviewerProfile','gradeEvidence']:
            if not isinstance(result[field],str) or not result[field].strip():
                raise ValueError(f'missing provenance: {field}')
        if result['executionMode'] not in ['admitted_live','immutable_fixture_replay']:
            raise ValueError('unknown execution mode')
        for field in ['taskSuccess','firstPass','correctOutcome','criticalFailure']:
            if type(result[field]) is not bool:
                raise ValueError(f'{field} must be boolean')
        for field in ['totalCostUsd','latencyMs','inputTokens','outputTokens','providerCalls','repairs','fallbacks']:
            value=result[field]
            if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:
                raise ValueError(f'invalid metric: {field}')
            if field not in ['totalCostUsd','latencyMs'] and int(value)!=value:
                raise ValueError(f'{field} must be an integer')
        if result['executionMode']=='immutable_fixture_replay' and (result['totalCostUsd']!=0 or result['providerCalls']!=0):
            raise ValueError('fixture replay cannot report provider spend')
        if result['firstPass'] and (result['repairs'] or result['fallbacks']):
            raise ValueError('first-pass result cannot include repair or fallback')
        groups[(trial['skill'],trial['configuration'],trial['profile'],result['executionMode'],evidence_class(result))].append(result)
    summary=[]
    for (skill,config,profile,mode,evidence), rows in sorted(groups.items()):
        successful=sum(successful_task(r) for r in rows)
        latency=sorted(r['latencyMs'] for r in rows)
        entry={'skill':skill,'configuration':config,'profile':profile,'executionMode':mode,'evidenceClass':evidence,
               'completedTrials':len(rows),'successfulTasks':successful,
               'successRate':successful/len(rows),'successWilson95':wilson(successful,len(rows)),
               'criticalFailures':sum(r['criticalFailure'] for r in rows),
               'firstPassRate':sum(successful_task(r) and r['firstPass'] for r in rows)/len(rows),
               'correctOutcomeRate':sum(r['correctOutcome'] for r in rows)/len(rows),
               'costPerSuccessfulTaskUsd':sum(r['totalCostUsd'] for r in rows)/successful if successful else None,
               'p50LatencyMs':statistics.median(latency),'p95LatencyMs':latency[max(0,math.ceil(.95*len(latency))-1)],
               'metrics':{key:stats([r[key] for r in rows]) for key in ['totalCostUsd','inputTokens','outputTokens','providerCalls','repairs','fallbacks']},
               'cases':[{'trialId':r['trialId'],'success':successful_task(r),
                         'reportedTaskSuccess':r['taskSuccess'],'correctOutcome':r['correctOutcome'],
                         'criticalFailure':r['criticalFailure'],'gradeEvidence':r['gradeEvidence']} for r in rows]}
        summary.append(entry)
    return {'expectedTrials':len(trials),'observedTrials':len(results),'complete':len(seen)==len(expected),
            'missingTrialIds':sorted(set(expected)-seen),'groups':summary,
            'qualification':'Metrics only. Live results without provider calls measure runtime outcomes, not provider qualification. Missing trials, replay results and aggregate scores never grant certification or activation. Repetitions share cases; trial confidence intervals are descriptive, not proof of model equivalence.'}


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    prep=commands.add_parser('prepare')
    prep.add_argument('--profile',action='append',required=True)
    prep.add_argument('--repetitions',type=int,default=3)
    prep.add_argument('--output',type=Path,required=True)
    collect=commands.add_parser('summarize')
    collect.add_argument('--trials',type=Path,required=True)
    collect.add_argument('--results',type=Path,required=True)
    collect.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.command=='prepare':
        cases=json.loads((ROOT/'erp-skills/evals/pilot-cases.json').read_text())['cases']
        trials=prepare(cases,args.profile,args.repetitions)
        args.output.write_text(''.join(json.dumps(t)+'\n' for t in trials))
        print(f'Prepared {len(trials)} offline trials. No provider dispatched.')
    else:
        report=summarize(read_jsonl(args.trials),read_jsonl(args.results))
        args.output.write_text(json.dumps(report,indent=2)+'\n')
        print(f"Observed {report['observedTrials']}/{report['expectedTrials']} trials; complete={report['complete']}")


if __name__=='__main__':
    main()
