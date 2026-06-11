import ast
import sys

def check_file(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            code = f.read()
        tree = ast.parse(code)
    except Exception as e:
        print(f"Error parsing file: {e}")
        return

    # วิเคราะห์ขอบเขต (scopes) ของฟังก์ชันเพื่อหา NameError
    class ScopeVisitor(ast.NodeVisitor):
        def __init__(self):
            self.scopes = []  # List of sets of defined names

        def visit_FunctionDef(self, node):
            # ฟังก์ชันระดับใหม่
            defined_in_fn = set()
            # พารามิเตอร์ของฟังก์ชัน
            for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
                defined_in_fn.add(arg.arg)
            if node.args.vararg:
                defined_in_fn.add(node.args.vararg.arg)
            if node.args.kwarg:
                defined_in_fn.add(node.args.kwarg.arg)

            self.scopes.append(defined_in_fn)
            
            # ทราเวิร์สเนื้อหาฟังก์ชัน
            self.generic_visit(node)
            
            self.scopes.pop()

        def visit_Assign(self, node):
            # ตรวจสอบการประกาศตัวแปรใหม่ในสโคปปัจจุบัน
            if self.scopes:
                for target in node.targets:
                    self.extract_targets(target, self.scopes[-1])
            self.generic_visit(node)

        def visit_For(self, node):
            if self.scopes:
                self.extract_targets(node.target, self.scopes[-1])
            self.generic_visit(node)

        def visit_ListComp(self, node):
            # List comprehension introduce local scope for its generators in python 3
            defined_in_comp = set()
            for gen in node.generators:
                self.extract_targets(gen.target, defined_in_comp)
            self.scopes.append(defined_in_comp)
            self.generic_visit(node)
            self.scopes.pop()

        def extract_targets(self, node, scope_set):
            if isinstance(node, ast.Name):
                scope_set.add(node.id)
            elif isinstance(node, (ast.Tuple, ast.List)):
                for elt in node.elts:
                    self.extract_targets(elt, scope_set)

        def visit_Name(self, node):
            if isinstance(node.ctx, ast.Load):
                # โหลดตัวแปรขึ้นมาใช้ เช็คว่ามีอยู่ในฟังก์ชันหรือโกลบอล หรือ built-in หรือไม่
                var_name = node.id
                if var_name == "confidence":
                    # เช็คว่าตัวแปรนี้ถูกประกาศในสโคปใดๆ ของฟังก์ชันที่ซ้อนกันอยู่หรือไม่
                    is_defined = False
                    for scope in reversed(self.scopes):
                        if var_name in scope:
                            is_defined = True
                            break
                    if not is_defined:
                        # หาว่าอยู่ในระดับ global (นอกสุด) หรือไม่
                        # เพื่อความง่าย เราเช็คชื่อฟังก์ชันปัจจุบันด้วย
                        print(f"Warning: 'confidence' used on line {node.lineno} but might not be defined in function scope.")

    visitor = ScopeVisitor()
    visitor.visit(tree)

if __name__ == "__main__":
    check_file("scripts/external_ocr_bridge.py")
