"""Extract the learner's question without changing the submitted message."""

import re


def question_outside_quotes(text: str) -> str:
    fence_length = 0
    question: list[str] = []
    for line in text.splitlines():
        if fence_length:
            close = re.fullmatch(r" {0,3}(`{3,})[ \t]*", line)
            if close and len(close[1]) >= fence_length:
                fence_length = 0
        else:
            opening = re.fullmatch(r" {0,3}(`{3,})[^`]*", line)
            if opening:
                fence_length = len(opening[1])
            else:
                question.append(line)
    return "\n".join(question).strip()
