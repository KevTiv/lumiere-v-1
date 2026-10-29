import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

SCRIPTS=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(SCRIPTS))
import erp_skill_benchmark as benchmark
import erp_skill_catalog as catalog


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.cases=json.loads((catalog.ROOT/'erp-skills/evals/pilot-cases.json').read_text())['cases']
        self.trials=benchmark.prepare(self.cases,['cheap@1','alternative@1','reference@1'])

    def result(self, trial=None):
        trial=trial or self.trials[0]
        return {**{key:trial[key] for key in ['trialId','promptHash','profile','skill','configuration']},
                'provider':'instrumented-fixture','modelRevision':'fixture@1','runtimeBinding':'test-binding',
                'fixtureHash':'test-fixture','reviewerProfile':'independent@1','gradeEvidence':'fixture-result.json',
                'executionMode':'immutable_fixture_replay','taskSuccess':True,'firstPass':True,'correctOutcome':True,
                'criticalFailure':False,'totalCostUsd':0,'latencyMs':20,'inputTokens':0,'outputTokens':0,
                'providerCalls':0,'repairs':0,'fallbacks':0}

    def test_matrix_is_paired_and_never_includes_grading_answers(self):
        self.assertEqual(len(self.trials),720)
        self.assertEqual(len({t['trialId'] for t in self.trials}),720)
        for trial in self.trials:
            self.assertNotIn('expectedOutcome',trial)
            self.assertNotIn('grading',trial)
        for case in self.cases:
            subset=[t for t in self.trials if t['caseId']==case['id']]
            self.assertEqual({t['configuration'] for t in subset},{'current','candidate'})
        self.assertNotEqual(self.trials[0]['promptHash'],self.trials[9]['promptHash'])

    def test_missing_results_are_visible_and_do_not_count_as_passes(self):
        report=benchmark.summarize(self.trials,[self.result()])
        self.assertFalse(report['complete'])
        self.assertEqual(len(report['missingTrialIds']),719)
        self.assertEqual(report['observedTrials'],1)
        empty=benchmark.summarize(self.trials,[])
        self.assertFalse(empty['complete'])
        self.assertEqual(empty['groups'],[])

    def test_duplicate_forged_or_invalid_metrics_reject(self):
        good=self.result()
        with self.assertRaises(ValueError): benchmark.summarize(self.trials,[good,good])
        for field,value in [('promptHash','forged'),('totalCostUsd',float('nan')),
                            ('inputTokens',1.5),('providerCalls',True),('gradeEvidence',''),
                            ('firstPass','true'),('executionMode','pretend-live'),('totalCostUsd',1)]:
            result={**good,field:value}
            with self.assertRaises(ValueError,msg=field): benchmark.summarize(self.trials,[result])

    def test_critical_failure_cannot_be_counted_as_success_and_cost_includes_failures(self):
        trials=[self.trials[0],self.trials[1]]
        rows=[self.result(t) for t in trials]
        for row in rows:
            row['executionMode']='admitted_live'
            row['totalCostUsd']=0.1
            row['providerCalls']=3
        rows[1]['criticalFailure']=True
        report=benchmark.summarize(trials,rows)
        group=report['groups'][0]
        self.assertTrue(report['complete'])
        self.assertEqual(group['successfulTasks'],1)
        self.assertEqual(group['criticalFailures'],1)
        self.assertAlmostEqual(group['costPerSuccessfulTaskUsd'],0.2)

    def test_all_skills_have_a_distinct_review_scenario_set(self):
        remaining=json.loads((catalog.ROOT/'erp-skills/evals/review-cases.json').read_text())['skills']
        pilot={case['skill'] for case in self.cases}
        all_skills={p.parent.name for p in (catalog.ROOT/'erp-skills').glob('*/SKILL.md')}
        self.assertEqual(set(remaining)|pilot,all_skills)
        self.assertFalse(set(remaining)&pilot)
        for scenarios in remaining.values():
            self.assertGreaterEqual(len(set(scenarios)),10)

    def test_generated_inventory_fields_come_from_the_current_rust_contract(self):
        fields=catalog.contract_fields(catalog.FINANCE,'BankInput')
        self.assertEqual([f['name'] for f in fields],['statementId','query'])
        self.assertTrue(fields[0]['required'])
        self.assertFalse(fields[1]['required'])
        for path,text in catalog.generate().items():
            self.assertEqual(path.read_text(),text,str(path))


if __name__=='__main__': unittest.main()
