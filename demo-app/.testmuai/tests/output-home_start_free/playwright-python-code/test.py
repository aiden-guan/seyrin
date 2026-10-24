import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="e29df34e-3c72-45f3-848f-34af27ad8535",
    name="Verify Create Your Studio Page",
    tc_id="TC-4",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"create_your_studio_heading": "Create your studio"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:4480/', instruction_id='682d6e93-2314-48d5-bd37-e79393a01a33'):
        await page.goto("http://localhost:4480/")
    
    async with testmu.step('Clicking Start free signup link', instruction_id='1315f5ca-805a-4fb5-afbb-d6a7d562d2aa'):
        _loc_1 = page.locator("internal:role=link[name=\"Start free\"i]")
        
        await _loc_1.click()
    
    async with testmu.step('Waiting for signup page to finish loading', instruction_id='c2f42dca-76b2-4983-92e1-f2bf34e73de4'):
        await page.wait_for_timeout(700)
    
    async with testmu.step('Reading the main page heading'):
        set_var('create_your_studio_heading', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {8: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(8).textContent);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:role=heading[name="Create your studio"i]'], query='the main page heading text', expected_value='Create your studio', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='The page that opens has the heading "Create your studio".'))
    
    async with testmu.step('Assertion check', instruction_id='f1282615-d44a-450e-9325-e88f8eb82dcc'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'The page that opens has the heading "Create your studio".', 'passed': True, 'operator': 'equals', 'transforms': ['strip'], 'json_path': None, 'expected': 'Create your studio', 'extracted_value': '{{create_your_studio_heading}}', 'store_key': 'create_your_studio_heading', 'variable_refs': {'{{create_your_studio_heading}}': 'Create your studio'}}], 'sub_checks': [{'description': 'The page that opens has the heading "Create your studio".', 'store_key': 'create_your_studio_heading', 'expected_value': 'Create your studio', 'extracted_value': '{{create_your_studio_heading}}', 'operator': 'equals', 'transforms': ['strip']}], 'composite_operator': 'and', 'claim': 'the page that opens has the heading "Create your studio"'})


if __name__ == "__main__":
    testmu.run(test)