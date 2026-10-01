#!/usr/bin/env ruby
# frozen_string_literal: true

# Runs Gumroad's OWN sanitizer (Ai::PageSanitizer, from the open-source antiwork/gumroad repo) on a
# page and prints the same sanitization_report that `gumroad pages preview` returns.
#
# This is an offline stand-in for the server-side sanitizer step only. It is NOT the live preview:
# it cannot check content moderation, image hosting, or how Gumroad's wrapper renders the page.
#
#   gem install loofah addressable
#   ruby tools/sanitize.rb dist/landing.html [path/to/antiwork/gumroad]
#
# Writes dist/landing.sanitized.html (what would actually be stored) and exits 1 if anything was removed.

# Arabic content: never depend on the shell locale.
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8

require "json"
require "loofah"
require "addressable/uri"
require "cgi"
require "uri"

input = ARGV[0] || "dist/landing.html"
checkout = ARGV[1] || ENV["GUMROAD_REPO"] || File.expand_path("~/antiwork/gumroad")
source = File.join(checkout, "app/services/ai/page_sanitizer.rb")
abort "Cannot find #{source}. Clone https://github.com/antiwork/gumroad and pass its path." unless File.exist?(source)

# The sanitizer source uses two ActiveSupport helpers. Shim them (same semantics) rather than require Rails.
class Object
  def blank? = respond_to?(:empty?) ? !!empty? : !self
  def present? = !blank?
end

class String
  def blank? = /\A[[:space:]]*\z/.match?(self)
end

module Ai; end
load source

html = File.read(input, encoding: "UTF-8")
result = Ai::PageSanitizer.sanitize_with_report(html)
out = input.sub(/\.html\z/, ".sanitized.html")
File.write(out, result.html, encoding: "UTF-8")

report = result.report
puts JSON.pretty_generate(report)
puts "input:     #{html.length} chars"
puts "sanitized: #{result.html.length} chars -> #{out}"
puts report[:total_removed].zero? ? "OK: nothing removed" : "REMOVED #{report[:total_removed]} item(s)"
exit(report[:total_removed].zero? ? 0 : 1)
