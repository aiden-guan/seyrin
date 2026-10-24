import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="d3cc764a-3e39-4ac9-848c-4326c2dce642",
    name="Create New Account and Verify Welcome Message",
    tc_id="TC-6",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"welcome_message_check": "Welcome to Perch, Sam!"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:4480/signup', instruction_id='b60cd7ff-a586-41e2-ad06-7f44baa661c5'):
        await page.goto("http://localhost:4480/signup")
    
    async with testmu.step('Waiting for the account creation steps to finish', instruction_id='4c974ef3-ac93-4fc3-acf3-b5f2a75a4650'):
        await page.wait_for_timeout(1000)
    
    async with testmu.step('Type "Sam Lee" into "Your name"', instruction_id='6644cabd-901d-4059-85de-e990d9e16f26'):
        element_0 = page.locator("internal:role=textbox[name=\"Your name\"i]")
        
        try:
            await element_0.click(timeout=2000)
        except Exception:
            pass
        await element_0.fill("Sam Lee")
        try:
            await element_0.press("End", timeout=2000)
        except Exception:
            pass
    
    async with testmu.step('Type "sam@example.com" into "Email"', instruction_id='ccf2ebce-63e6-4169-bd4b-696a1718c7c3'):
        element_1 = page.locator("internal:role=textbox[name=\"Email\"i]")
        
        try:
            await element_1.click(timeout=2000)
        except Exception:
            pass
        await element_1.fill("sam@example.com")
        try:
            await element_1.press("End", timeout=2000)
        except Exception:
            pass
    
    async with testmu.step('Waiting while the next steps are running', instruction_id='1eda25b8-a8a3-44c4-93f0-d4f43e3eebe3'):
        await page.wait_for_timeout(1000)
    
    async with testmu.step('Type "Clay Corner" into "Studio name"', instruction_id='f6d19fbe-9c89-4b69-82ef-32589a71cc99'):
        element_2 = page.locator("internal:role=textbox[name=\"Studio name\"i]")
        
        try:
            await element_2.click(timeout=2000)
        except Exception:
            pass
        await element_2.fill("Clay Corner")
        try:
            await element_2.press("End", timeout=2000)
        except Exception:
            pass
    
    async with testmu.step('Clicking Create account button below the signup fields', instruction_id='fb530999-11fe-414d-9f89-46ce00547ac3'):
        _loc_1 = page.locator("internal:role=button[name=\"Create account\"i]")
        
        await _loc_1.click()
    
    async with testmu.step('Reading the welcome message from the signup page heading'):
        set_var('welcome_message_check', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {11: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(11).textContent);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:role=heading[name="Welcome to Perch, Sam!"i]'], query='the welcome message shown in the signup page heading', expected_value='Welcome to Perch, Sam!', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='The page shows the welcome message "Welcome to Perch, Sam!".'))
    
    async with testmu.step('Assertion check', instruction_id='924abb5e-cf91-41c0-a3ce-1c69b477e320'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'The page shows the welcome message "Welcome to Perch, Sam!".', 'passed': True, 'operator': 'equals', 'transforms': ['strip'], 'json_path': None, 'expected': 'Welcome to Perch, Sam!', 'extracted_value': '{{welcome_message_check}}', 'store_key': 'welcome_message_check', 'variable_refs': {'{{welcome_message_check}}': 'Welcome to Perch, Sam!'}}], 'sub_checks': [{'description': 'The page shows the welcome message "Welcome to Perch, Sam!".', 'store_key': 'welcome_message_check', 'expected_value': 'Welcome to Perch, Sam!', 'extracted_value': '{{welcome_message_check}}', 'operator': 'equals', 'transforms': ['strip']}], 'composite_operator': 'and', 'claim': 'a welcome message naming Sam ("Welcome to Perch, Sam!") is shown'})


if __name__ == "__main__":
    testmu.run(test)