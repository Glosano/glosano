import pytest

from glosano.modules.dictionary.external_templates import (
    MAX_TEMPLATE_LENGTH,
    InvalidTemplateError,
    is_valid_custom_template,
    validate_custom_template,
)


@pytest.mark.parametrize(
    "ok",
    [
        "https://context.reverso.net/translation/portuguese-russian/{word}",
        "https://www.google.com/search?tbm=isch&q={word}",
        "http://example.org/#{word}",
        "  https://dicionario.priberam.org/{word}  ",
        "HTTPS://example.org/{word}/{word}",
    ],
)
def test_accepts(ok: str) -> None:
    assert validate_custom_template(ok) == ok.strip()
    assert is_valid_custom_template(ok)


@pytest.mark.parametrize(
    ("bad", "code"),
    [
        ("javascript:alert(1)//{word}", "invalid_scheme"),
        ("data:text/html,{word}", "invalid_scheme"),
        ("ftp://example.org/{word}", "invalid_scheme"),
        ("//example.org/{word}", "invalid_scheme"),
        ("https:///{word}", "invalid_scheme"),
        ("https://[::1/{word}", "invalid_scheme"),
        ("https://exa mple.com/{word}", "invalid_scheme"),
        ("https://example.com:99999/{word}", "invalid_scheme"),
        ("https://example.com:abc/{word}", "invalid_scheme"),
        ("https://example.org/", "missing_placeholder"),
        ("https://example.org/{text}", "unknown_placeholder"),
        ("https://example.org/{word}}", "unknown_placeholder"),
        ("https://example.org/{word}{", "unknown_placeholder"),
        ("https://{word}.example.org/", "placeholder_in_host"),
        ("https://example.org:{word}/", "placeholder_in_host"),
        ("https://u{word}@example.org/", "placeholder_in_host"),
        ("https://example.org/" + "a" * 500 + "{word}", "too_long"),
    ],
)
def test_rejects(bad: str, code: str) -> None:
    with pytest.raises(InvalidTemplateError) as exc:
        validate_custom_template(bad)
    assert exc.value.code == code
    assert not is_valid_custom_template(bad)


def test_length_limit_applies_to_stripped_template() -> None:
    prefix = "https://example.org/"
    exact = prefix + "a" * (MAX_TEMPLATE_LENGTH - len(prefix) - len("{word}")) + "{word}"
    assert len(exact) == MAX_TEMPLATE_LENGTH
    assert validate_custom_template(f"  {exact}  ") == exact
    with pytest.raises(InvalidTemplateError) as exc:
        validate_custom_template(exact + "a")
    assert exc.value.code == "too_long"


def test_too_long_wins_over_other_errors() -> None:
    with pytest.raises(InvalidTemplateError) as exc:
        validate_custom_template("ftp://" + "a" * 600)
    assert exc.value.code == "too_long"
