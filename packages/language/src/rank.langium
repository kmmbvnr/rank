grammar Rank

interface Expression {}

entry Program:
    NL*
    (statements+=Statement
        (NL+ statements+=Statement)*)?
    NL*;

Statement:
    UseStatement |
    AssignmentStatement |
    ExpressionStatement;

UseStatement:
    'use' module=WORD;

AssignmentStatement:
    name=VARIABLE '=' value=Expression;

ExpressionStatement:
    value=Expression;

Expression returns Expression:
    OrExpression;

OrExpression returns Expression:
    AndExpression
    ({infer BinaryExpression.left=current}
        operator='or' right=AndExpression)*;

AndExpression returns Expression:
    ComparisonExpression
    ({infer BinaryExpression.left=current}
        operator='and' right=ComparisonExpression)*;

ComparisonExpression returns Expression:
    RangeExpression
    ({infer BinaryExpression.left=current}
        operator=ComparisonOperator right=RangeExpression)*;

ComparisonOperator returns string:
    'equal' | 'not' 'equal' | 'less' | 'greater';

RangeExpression returns Expression:
    AdditionExpression
    ({infer BinaryExpression.left=current}
        operator=('to' | 'until') right=AdditionExpression)?;

AdditionExpression returns Expression:
    MultiplicationExpression
    ({infer BinaryExpression.left=current}
        operator=('+' | '-') right=MultiplicationExpression)*;

MultiplicationExpression returns Expression:
    UnaryExpression
    ({infer BinaryExpression.left=current}
        operator=('*' | '/' | '%') right=UnaryExpression)*;

UnaryExpression returns Expression:
    {infer UnaryExpression}
        operator=('+' | '-' | 'not') operand=UnaryExpression |
    ApplicationExpression;

ApplicationExpression returns Expression:
    PrimaryExpression
    ({infer ApplicationExpression.head=current}
        arguments+=PrimaryExpression)+ |
    PrimaryExpression;

PrimaryExpression returns Expression:
    NumberLiteral |
    StringLiteral |
    BooleanLiteral |
    LabelLiteral |
    NameExpression |
    ParenthesizedExpression;

NumberLiteral:
    value=INTEGER;

StringLiteral:
    value=STRING;

BooleanLiteral:
    value=BooleanValue;

BooleanValue returns boolean:
    'true' | 'false';

LabelLiteral:
    '.' name=Identifier;

NameExpression:
    name=Identifier;

ParenthesizedExpression:
    '(' value=Expression ')';

Identifier returns string:
    VARIABLE | WORD;

hidden terminal WS: /[\t ]+/;
terminal NL: /\r?\n/;
terminal VARIABLE: /[A-Z][A-Za-z0-9_]*/;
terminal WORD: /[a-z][A-Za-z0-9_]*/;
terminal INTEGER returns bigint: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"/;

hidden terminal REM_COMMENT: /rem(?:[\t ]+[^\n\r]*)?/;
