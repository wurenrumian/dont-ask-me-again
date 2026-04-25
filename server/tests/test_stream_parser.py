from server.stream_parser import TaggedStreamParser


def test_stream_parser_handles_tags_across_chunks() -> None:
    parser = TaggedStreamParser()

    events = []
    events.extend(parser.feed("<thinking>reason"))
    events.extend(parser.feed("ing</thinking><answer>final"))
    events.extend(parser.feed(" answer</answer>"))
    events.extend(parser.flush())

    assert ("thinking_delta", "reasoning") in events
    assert ("answer_delta", "final answer") in events


def test_stream_parser_treats_plain_text_as_answer() -> None:
    parser = TaggedStreamParser()

    events = parser.feed("plain answer") + parser.flush()

    assert events == [("answer_delta", "plain answer")]


def test_stream_parser_accepts_uppercase_tags() -> None:
    parser = TaggedStreamParser()

    events = parser.feed("<THINKING>x</THINKING><ANSWER>y</ANSWER>") + parser.flush()

    assert events == [("thinking_delta", "x"), ("answer_delta", "y")]


def test_stream_parser_flushes_missing_close_tag() -> None:
    parser = TaggedStreamParser()

    events = parser.feed("<thinking>unfinished") + parser.flush()

    assert events == [("thinking_delta", "unfinished")]
