use std::collections::BTreeMap;

const MAX_DEPTH: usize = 32;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Text(String),
    Object(BTreeMap<String, Value>),
}

pub fn parse(input: &str) -> Result<BTreeMap<String, Value>, String> {
    let tokens = tokenize(input)?;
    let mut cursor = 0;
    parse_object(&tokens, &mut cursor, false, 0)
}

pub fn object<'a>(
    map: &'a BTreeMap<String, Value>,
    key: &str,
) -> Option<&'a BTreeMap<String, Value>> {
    match get(map, key)? {
        Value::Object(value) => Some(value),
        Value::Text(_) => None,
    }
}

pub fn text<'a>(map: &'a BTreeMap<String, Value>, key: &str) -> Option<&'a str> {
    match get(map, key)? {
        Value::Text(value) => Some(value),
        Value::Object(_) => None,
    }
}

fn get<'a>(map: &'a BTreeMap<String, Value>, key: &str) -> Option<&'a Value> {
    map.iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
        .map(|(_, value)| value)
}

fn parse_object(
    tokens: &[String],
    cursor: &mut usize,
    nested: bool,
    depth: usize,
) -> Result<BTreeMap<String, Value>, String> {
    if depth > MAX_DEPTH {
        return Err("VDF nesting exceeds the supported depth.".to_string());
    }
    let mut result = BTreeMap::new();
    while *cursor < tokens.len() {
        if tokens[*cursor] == "}" {
            if !nested {
                return Err("Unexpected closing brace in VDF file.".to_string());
            }
            *cursor += 1;
            return Ok(result);
        }
        let key = tokens[*cursor].clone();
        *cursor += 1;
        let token = tokens
            .get(*cursor)
            .ok_or_else(|| format!("Missing value for VDF key {key}."))?;
        if token == "{" {
            *cursor += 1;
            result.insert(
                key,
                Value::Object(parse_object(tokens, cursor, true, depth + 1)?),
            );
        } else {
            result.insert(key, Value::Text(token.clone()));
            *cursor += 1;
        }
    }
    if nested {
        Err("Unclosed object in VDF file.".to_string())
    } else {
        Ok(result)
    }
}

fn tokenize(input: &str) -> Result<Vec<String>, String> {
    let chars = input.chars().collect::<Vec<_>>();
    let mut tokens = Vec::new();
    let mut cursor = 0;
    while cursor < chars.len() {
        if chars[cursor].is_whitespace() {
            cursor += 1;
            continue;
        }
        if chars[cursor] == '/' && chars.get(cursor + 1) == Some(&'/') {
            while cursor < chars.len() && chars[cursor] != '\n' {
                cursor += 1;
            }
            continue;
        }
        if chars[cursor] == '{' || chars[cursor] == '}' {
            tokens.push(chars[cursor].to_string());
            cursor += 1;
            continue;
        }
        if chars[cursor] != '"' {
            return Err(format!("Unexpected character in VDF file at {cursor}."));
        }
        cursor += 1;
        let mut value = String::new();
        let mut closed = false;
        while cursor < chars.len() {
            match chars[cursor] {
                '"' => {
                    cursor += 1;
                    closed = true;
                    break;
                }
                '\\' => match chars.get(cursor + 1).copied() {
                    Some('"') => {
                        value.push('"');
                        cursor += 2;
                    }
                    Some('\\') => {
                        value.push('\\');
                        cursor += 2;
                    }
                    Some('n') => {
                        value.push('\n');
                        cursor += 2;
                    }
                    Some('t') => {
                        value.push('\t');
                        cursor += 2;
                    }
                    _ => {
                        value.push('\\');
                        cursor += 1;
                    }
                },
                character => {
                    value.push(character);
                    cursor += 1;
                }
            }
        }
        if !closed {
            return Err("Unclosed quoted string in VDF file.".to_string());
        }
        tokens.push(value);
    }
    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_valve_text() {
        let input = r#""root" { "apps" { "730" { "Playtime" "42" } } }"#;
        let root = parse(input).unwrap();
        let apps = object(object(&root, "root").unwrap(), "apps").unwrap();
        assert_eq!(text(object(apps, "730").unwrap(), "playtime"), Some("42"));
    }

    #[test]
    fn parses_escaped_quotes_and_rejects_malformed_input() {
        let parsed = parse(r#""root" { "name" "A \"quoted\" game" }"#).unwrap();
        assert_eq!(
            text(object(&parsed, "root").unwrap(), "name"),
            Some("A \"quoted\" game")
        );
        assert!(parse(r#""root" { "name" "unfinished"#).is_err());
    }

    #[test]
    fn caps_nesting_depth() {
        let mut input = String::new();
        for index in 0..34 {
            input.push_str(&format!("\"{index}\" {{ "));
        }
        input.push_str("\"value\" \"1\"");
        input.push_str(&" }".repeat(34));
        assert!(parse(&input).is_err());
    }
}
