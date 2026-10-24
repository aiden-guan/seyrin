import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="043fe7d8-4c6c-4834-a68e-dae64d98afee",
    name="Web || aidenguan || TC-8",
    tc_id="TC-8",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"free_monthly_price_check": "$0", "pro_monthly_price_check": "$12", "team_monthly_price_check": "$29"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:4480/pricing', instruction_id='62030681-c8f6-4af7-ae44-d71f1d580228'):
        await page.goto("http://localhost:4480/pricing")
    
    async with testmu.step('Reading the Free plan monthly price amount'):
        set_var('free_monthly_price_check', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {13: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(13).textContent.trim().match(/^\\$\\d+(?:\\.\\d+)?/)?.[0] ?? null);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:text="$0 / month"i'], query='the Free plan monthly price amount', expected_value='$0', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='The page lists the Free plan at $0 per month.'))
    
    async with testmu.step('Reading the Pro plan monthly price amount'):
        set_var('pro_monthly_price_check', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {24: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(24).textContent.trim().match(/^\\$\\d+(?:\\.\\d+)?/)?.[0] ?? null);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:text="$12 / month"i'], query='the Pro plan monthly price amount', expected_value='$12', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='The page lists the Pro plan at $12 per month.'))
    
    async with testmu.step('Reading the Team plan monthly price amount'):
        set_var('team_monthly_price_check', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {35: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(35).textContent.trim().match(/^\\$\\d+(?:\\.\\d+)?/)?.[0] ?? null);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:text="$29 / month"i'], query='the Team plan monthly price amount', expected_value='$29', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='The page lists the Team plan at $29 per month.'))
    
    async with testmu.step('Assertion check', instruction_id='063523b7-cb00-4ef2-b5bf-b9e6a826a7d4'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'The page lists the Free plan at $0 per month.', 'passed': True, 'operator': 'equals', 'transforms': ['strip'], 'json_path': None, 'expected': '$0', 'extracted_value': '{{free_monthly_price_check}}', 'store_key': 'free_monthly_price_check', 'variable_refs': {'{{free_monthly_price_check}}': '$0'}}, {'description': 'The page lists the Pro plan at $12 per month.', 'passed': True, 'operator': 'equals', 'transforms': ['strip'], 'json_path': None, 'expected': '$12', 'extracted_value': '{{pro_monthly_price_check}}', 'store_key': 'pro_monthly_price_check', 'variable_refs': {'{{pro_monthly_price_check}}': '$12'}}, {'description': 'The page lists the Team plan at $29 per month.', 'passed': True, 'operator': 'equals', 'transforms': ['strip'], 'json_path': None, 'expected': '$29', 'extracted_value': '{{team_monthly_price_check}}', 'store_key': 'team_monthly_price_check', 'variable_refs': {'{{team_monthly_price_check}}': '$29'}}], 'sub_checks': [{'description': 'The page lists the Free plan at $0 per month.', 'store_key': 'free_monthly_price_check', 'expected_value': '$0', 'extracted_value': '{{free_monthly_price_check}}', 'operator': 'equals', 'transforms': ['strip']}, {'description': 'The page lists the Pro plan at $12 per month.', 'store_key': 'pro_monthly_price_check', 'expected_value': '$12', 'extracted_value': '{{pro_monthly_price_check}}', 'operator': 'equals', 'transforms': ['strip']}, {'description': 'The page lists the Team plan at $29 per month.', 'store_key': 'team_monthly_price_check', 'expected_value': '$29', 'extracted_value': '{{team_monthly_price_check}}', 'operator': 'equals', 'transforms': ['strip']}], 'composite_operator': 'and', 'claim': 'the page lists three plans with their monthly prices: Free at $0, Pro at $12 and Team at $29'})


if __name__ == "__main__":
    testmu.run(test)