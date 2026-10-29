"""评分和约束 schema 的关键边界检查。"""
import json
import unittest

from run_eval import schema_for
from score import field_score, no_duplicate_keys, valid_output


class MetricsTest(unittest.TestCase):
    def test_money_tolerance_and_bool_rejection(self):
        f={"id":"amount","type":"money","currency":"EUR"}
        self.assertTrue(field_score(14.5,14.51,f)[0])
        self.assertFalse(field_score(14.5,14.52,f)[0])
        self.assertFalse(field_score(1.0,True,f)[0])

    def test_text_normalization(self):
        self.assertTrue(field_score("ＡＢ Ｃ","ABC",{"id":"merchant","type":"text"})[0])

    def test_choice_rejects_unknown_id_and_extra_key(self):
        fields=[{"id":"category","type":"choice","options":[{"id":"food","label":"Food"}]}]
        schema={"fields":fields}
        self.assertTrue(valid_output({"category":"food"},schema))
        self.assertTrue(valid_output({"category":None},schema))
        self.assertFalse(valid_output({"category":"transport"},schema))
        self.assertFalse(valid_output({"category":None,"extra":1},schema))
        self.assertEqual(schema_for(fields)["properties"]["category"]["anyOf"][1],{"type":"null"})

    def test_duplicate_json_key_rejected(self):
        with self.assertRaises(ValueError):
            json.loads('{"amount":1,"amount":2}',object_pairs_hook=no_duplicate_keys)


if __name__=="__main__": unittest.main()
