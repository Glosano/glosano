from glosano.modules.chat.prompts import system_prompt


def test_chat_prompt_names_the_ui_language() -> None:
    assert "Explain in Russian." in system_prompt("ru", "en")


def test_chat_prompt_names_european_portuguese_for_the_pt_ui() -> None:
    assert "Explain in European Portuguese." in system_prompt("pt", "en")


def test_chat_prompt_falls_back_to_the_raw_code() -> None:
    assert "Explain in xx." in system_prompt("xx", "en")
